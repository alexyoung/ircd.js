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
    tls = require('tls'),
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
    ServerCommands = require('./commands'),
    winston = require('winston'),
    commander = require('commander')
    exists = fs.exists || path.exists // 0.8 moved exists to fs
    ;

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
  this.commands = new ServerCommands(this);
}

Server.boot = function() {
  var server = new Server();

  server.file = server.cliParse();

  server.loadConfig(function() {
    server.start();
    server.createDefaultChannels();
  });

  process.on('SIGHUP', function() {
    winston.info('Reloading config...');
    server.loadConfig();
  });

  process.on('SIGTERM', function() {
    winston.info('Exiting...');
    server.close();
  });
};

Server.prototype = {
  version: '0.0.17',
  created: '2012-09-21',
  debug: false,
  get name() { return this.config.serverName; },
  get info() { return this.config.serverDescription; },
  get token() { return this.config.token; },
  get host() { return ':' + this.config.hostname; },

  cliParse: function() {
    var file = null;

    commander.option('-f --file [file]','Configuration file (Defaults: /etc/ircdjs/config.json or ../config/config.json)')
      .parse(process.argv);
    // When the -f switch is passwd without a parameter, commander.js evaluates it to true.
    if (commander.file && commander.file !== true) file = commander.file;
    return file;
  },

  loadConfig: function(fn) {
    var server = this,
        paths = [
          path.join('/', 'etc', 'ircdjs', 'config.json'),
          path.join(__dirname, '..', 'config', 'config.json')
        ];

    this.config = null;
    if (server.file) paths.unshift(server.file);

    paths.forEach(function(name) {
      exists(name, function(exists) {
        if (!exists || server.config) return;
        try {
          server.config = JSON.parse(fs.readFileSync(name).toString());
          server.config.idleTimeout = server.config.idleTimeout || 60;
          winston.info('Using config file: ' + name);
          if (fn) fn();
        } catch (exception) {
          winston.error('Please ensure you have a valid config file.', exception);
        }
      });
    });
  },

  normalizeName: function(name) {
    return name &&
           name.toLowerCase()
           .replace(/{/g, '[')
           .replace(/}/g, ']')
           .replace(/\|/g, '\\')
           .trim();
  },

  isValidPositiveInteger: function(str) {
    var n = ~~Number(str);
    return String(n) === str && n >= 0;
  },

  valueExists: function(value, collection, field) {
    var self = this;
    value = this.normalizeName(value);
    return collection.some(function(u) {
      return self.normalizeName(u[field]) === value;
    })
  },

  channelTarget: function(target) {
    var prefix = target[0];
    return prefix === '#' || prefix === '&'
  },

  parse: function(data) {
    var parts = data.trim().split(/ :/),
        args = parts[0].split(' ');

    parts = [parts.shift(), parts.join(' :')];

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

  respondToMessage: function(user, message) {
    this.commands[message.command].apply(this.commands, [user].concat(message.args));
  },

  respond: function(data, client) {
    var message = this.parse(data);

    if (this.validCommand(message.command)) {
      if (this.config.serverPassword && !client.object.passwordAccepted) {
        this.queueResponse(client, message);
      } else {
        this.respondToMessage(client.object, message);
      }
    }
  },

  queueResponse: function(client, message) {
    if ('PASS' === message.command) {
      // Respond now
      client.object.pendingAuth = false;
      this.respondToMessage(client.object, message);
    } else {
      client.object.queue(message);
    }
  },

  validCommand: function(command) {
    return this.commands[command];
  },

  createDefaultChannels: function() {
    var self = this;
    if (this.config.channels) {
      Object.keys(this.config.channels).forEach(function(channel) {
        var channelName = '';
        //make sure the channel name is valid as per RFC 2813
        if (!channel.match(/^[#&]\w+/)) { 
          channelName = "#" + channel;
        } else {
          channelName = channel;
        }
        var newChannel = self.channels.registered[self.normalizeName(channelName)] = new Channel(channelName, self);
        newChannel.topic = self.config.channels[channel].topic;
      });
    }
  },

  motd: function(user) {
    user.send(this.host, irc.reply.motdStart, user.nick, ':- Message of the Day -');
    user.send(this.host, irc.reply.motd, user.nick, this.config.motd || 'No message set');
    user.send(this.host, irc.reply.motdEnd, user.nick, ':End of /MOTD command.');
  },

  startTimeoutHandler: function() {
    var self = this;
    var timeout = this.config.pingTimeout || 10;
    this.timeoutHandler = setInterval(function() {
      self.users.forEach(function(user) {
        if (user.hasTimedOut()) {
          winston.info('User timed out:', user.mask);
          self.disconnect(user);
        } else {
          // TODO: If no other activity is detected
          user.send('PING', self.config.hostname, self.host);
        }
      });
    }, timeout * 1000);
  },

  stopTimeoutHandler: function() {
    clearInterval(this.timeoutHandler);
  },

  start: function(callback) {
    var server = this, key, cert, options;

    if (this.config.key && this.config.cert) {
      try {
        key = fs.readFileSync(this.config.key);
        cert = fs.readFileSync(this.config.cert);
      } catch (exception) {
        winston.error('Fatal error:', exception);
      }
      options = { key: key, cert: cert };
      this.server = tls.createServer(options, handleStream);
    } else {
      this.server = net.createServer(handleStream);
    }

    assert.ok(callback === undefined || typeof callback == 'function');
    this.server.listen(this.config.port, callback);
    winston.info('Server listening on port: ' + this.config.port);

    this.startTimeoutHandler();

    function handleStream(stream) {
      try {
        var carry = carrier.carry(stream),
            client = new AbstractConnection(stream);

        client.object = new User(client, server);
        if (server.config.serverPassword) {
          client.object.pendingAuth = true;
        }

        stream.on('end', function() { server.end(client); });
        stream.on('error', winston.error);
        carry.on('line',  function(line) { server.data(client, line); });
      } catch (exception) {
        winston.error('Fatal error:', exception);
      }
    }
  },

  close: function(callback) {
    if (callback !== undefined) {
      assert.ok(typeof callback === 'function');
      this.server.once('close', callback);
    }
    this.stopTimeoutHandler();
    this.server.close();
  },

  end: function(client) {
    var user = client.object;

    if (user) {
      this.disconnect(user);
    }
  },

  disconnect: function(user) {
    user.channels.forEach(function(channel) {
      channel.users.forEach(function(channelUser) {
        if (channelUser !== user) {
          channelUser.send(user.mask, 'QUIT', user.quitMessage);
        }
      });

      channel.users.splice(channel.users.indexOf(user), 1);
    });

    user.closeStream();
    this.users.remove(user);
    user = null;
  },

  data: function(client, line) {
    line = line.slice(0, 512);
    winston.info('[' + this.name + ', C: ' + client.id + '] ' + line);
    this.respond(line, client);
  }
};

exports.Server = Server;

if (!module.parent) {
  Server.boot();
}
