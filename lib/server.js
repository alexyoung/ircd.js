//
// ::::::::::..     .,-::::::::::::-.         ....:::::: .::::::. 
// ;;;;;;;``;;;;  ,;;;'````' ;;,   `';,    ;;;;;;;;;````;;;`    ` 
// [[[ [[[,/[[['  [[[        `[[     [[    ''`  `[[.    '[==/[[[[,
// $$$ $$$$$$c    $$$         $$,    $$   ,,,    `$$      '''    $
// 888 888b "88bo,`88bo,__,o, 888_,o8P'd8b888boood88     88b    dP
// MMM MMMM   "W"   "YUMMMMMP"MMMMP"`  YMP"MMMMMMMM"      "YMmMY" 
//
//                                            A Node.JS IRC Server
// ircd.js

// libs:
// http://github.com/pgte/carrier

// rfcs:
// http://www.networksorcery.com/enp/rfc/rfc2812.txt
// http://tools.ietf.org/html/rfc1459
//
// spells out some stuff the RFC was light on:
// http://docs.dal.net/docs/misc.html#5

var net = require('net'),
    carrier = require('carrier'),
    fs = require('fs'),
    irc = require('./protocol'),
    path = require('path'),
    assert = require('assert'),
    Channel = require('./channel').Channel,
    User = require('./user').User,
    History = require('./storage').History,
    ChannelDatabase = require('./storage').ChannelDatabase,
    UserDatabase = require('./storage').UserDatabase,
    EventEmitter = require('events').EventEmitter,
    serverCommands = require('./commands'),
    server,
    showLog = true;

// TODO: Proper logging
function log() {
  if (showLog) {
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(this, args);
  }
}

function AbstractConnection(stream) {
  this.stream = stream;
  this.object = null;

  this.__defineGetter__('id', function() {
    return this.object ? this.object.id : 'Unregistered';
  });
}

function Server() {
  this.history = new History(this);
  this.users = new UserDatabase(this);
  this.channels = new ChannelDatabase(this);
  this.config = null;
  this.events = new EventEmitter();
  this.commands = serverCommands;
  this.installEventHandlers();
}

Server.boot = function() {
  var server = new Server();

  server.loadConfig(function() {
    server.start();
  });

  process.on('SIGHUP', function () {
    log('Reloading config...');
    server.loadConfig();
  });
};

Server.prototype = {
  version: '0.1',
  created: '2010-10-20',
  debug: false,
  get name() { return this.config.serverName; },
  get info() { return this.config.serverDescription; },
  get token() { return this.config.token; },
  get host() { return ':' + this.config.hostname; },
  set showLog(show) { showLog = show; },
  log: log,

  loadConfig: function(fn) {
    var server = this;
    this.config = null;

    [path.join('/', 'etc', 'ircdjs', 'config.json'),
     path.join(__dirname, '..', 'config', 'config.json')].forEach(function(name) {
      path.exists(name, function(exists) {
        if (!exists || server.config) return;
        try {
          server.config = JSON.parse(fs.readFileSync(name).toString());
          if (fn) fn();
        } catch (exception) {
          log('Please ensure you have a valid config file.  ', exception.toString());
        }
      });
    });
  },

  installEventHandlers: function() {
    var self = this;
    for (var c in this.commands) {
      (function(command) {
        self.events.on(command, function() {
          self.commands[command].apply(self, arguments);
        });
      }(c));
    }
  },

  normalizeName: function(name) {
    return name &&
           name.toLowerCase()
           .replace(/{/g, '[')
           .replace(/}/g, ']')
           .replace(/\|/g, '\\');
  },

  valueExists: function(value, collection, field) {
    var context = this;
    value = context.normalizeName(value);
    return collection.some(function(u) {
      return context.normalizeName(u[field]) === value;
    })
  },

  channelTarget: function(target) {
    var prefix = target[0];
    return prefix === '#' || prefix === '&'
  },

  parse: function(data) {
    var parts = data.trim().split(/ :/),
        args = parts[0].split(' ');

    if (parts.length > 0) {
      args.push(parts[1]);
    }
    
    if (data.match(/^:/)) {
      args[1] = args.splice(0, 1, args[1]);
      args[1] = (args[1] + '').replace(/^:/, '');
    }

    return {
      command: args[0].toUpperCase(),
      args: args.slice(1)
    };
  },

  respond: function(data, client) {
    var message = this.parse(data);

    if (this.commands[message.command]) {
      this.events.emit.apply(this.events, [message.command, client.object].concat(message.args));
    }
  },

  motd: function(user) {
    user.send(this.host, irc.reply.motdStart, user.nick, ':- Message of the Day -');
    user.send(this.host, irc.reply.motd, user.nick, ':-');
    user.send(this.host, irc.reply.motdEnd, user.nick, ':End of /MOTD command.');
  },

  start: function(callback) {
    var server = this;
    this.tcpServer = net.createServer(function(stream) {
      try {
        var carry = carrier.carry(stream),
            client = new AbstractConnection(stream);

        client.object = new User(client.stream, server);

        stream.on('end', function() { server.end(client); });
        stream.on('error', server.error);
        carry.on('line',  function(line) { server.data(client, line); });
      } catch (exception) {
        log('Fatal error: ', exception);
      }
    });

    assert.ok(callback === undefined || typeof callback == 'function');
    this.tcpServer.listen(this.config.port, callback);
  },

  close: function(callback) {
    if (callback !== undefined) {
      assert.ok(typeof callback === 'function');
      this.tcpServer.once('close', callback);
    }
    this.tcpServer.close();
  },

  end: function(client) {
    var user = client.object;
    
    if (user) {
      user.channels.forEach(function(channel) {
        channel.users.forEach(function(channelUser) {
          if (channelUser !== user) {
            channelUser.send(user.mask, 'QUIT', user.quitMessage);
          }
        });

        channel.users.splice(channel.users.indexOf(user), 1);
      });

      this.users.remove(user);
      user = null;
    }
  },

  error: function(error) {
    log('*** ERROR: ' + error);
  },

  data: function(client, line) {
    line = line.slice(0, 512);
    log('[' + this.name + ', C: ' + client.id + '] ' + line);
    this.respond(line, client);
  }
};

exports.Server = Server;

if (!module.parent) {
  Server.boot();
}
