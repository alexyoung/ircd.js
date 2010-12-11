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
    sha1 = require('./hash').sha1,
    Channel = require('./channel').Channel,
    User = require('./user').User,
    History = require('./storage').History,
    ChannelDatabase = require('./storage').ChannelDatabase,
    UserDatabase = require('./storage').UserDatabase,
    LinkDatabase = require('./storage').LinkDatabase;

// TODO: Proper logging
function log(m) {
  console.log.apply(this, Array.prototype.slice.call(arguments));
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
  this.servers = new LinkDatabase(this);
}

Server.prototype = {
  version: '0.1',
  created: '2010-10-20',
  debug: false,
  get name() { return this.config.serverName; },
  get info() { return this.config.serverDescription; },
  get token() { return this.config.token; },
  get host() { return ':' + this.config.hostname; },
  log: log,

  loadConfig: function() {
    try {
      this.config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'config.js')).toString());
      return true;
    } catch (exception) {
      log('Please ensure you have a valid config file:');
      log(exception);
    }
    return false;
  },

  serverCommands: {
    PONG: function(server, hostname) {
      server.send('PING', hostname);
    },

    SERVER: function(server, serverName, hopCount, token, info) {
      // ERR_ALREADYREGISTRED
      if (server.name === serverName) {
        /*
        server.hopCount = hopCount;
        server.token = token;
        server.info = info;
        */
        server.gotServerInfo = true;
        this.completeLinkConnection(server);
      } else {
        // TODO: Register info about another server
      }
    },

    PASS: function(server, password, version, flags, options) {
      // TODO: Spec says stuff about only doing this once, etc.
      if (password === server.password) {
        server.authenticated = true;
      } else {
        server.send('ERROR', 'Incorrect link password');
      }
    },

    NICK: function(server, nick, hopcount, username, host, servertoken, umode, realname) {
      var user = new User(null, Server);
      user.nick = nick;
      user.hopCount = hopcount;
      user.username = username;
      user.hostname = host;
      user.servertoken = servertoken;
      user.modes = umode;
      user.realname = realname;
      this.users.push(user);
    }
  },

  commands: {
    CONNECT: function(user, targetServer, port, remoteServer) {
      // ERR_NOSUCHSERVER
      // ERR_NEEDMOREPARAMS
      if (!user.isOper) {
        user.send(this.host, irc.errors.noPrivileges, ':Permission denied');
      } else {
        if (!targetServer) {
          user.send(this.host, irc.errors.needMoreParams, ':Please specify a target server');
        } else {
          this.servers.connect(targetServer, port, remoteServer);
        }
      }
    },

    PING: function(user, hostname) {
      user.send(this.host, 'PONG', this.config.hostname, this.host);
    },

    AWAY: function(user, message) {
      if (user.isAway && (!message || message.length === 0)) {
        user.isAway = false;
        user.awayMessage = null;
        user.send(this.host, irc.reply.unaway, user.nick, ':You are no longer marked as being away');
      } else {
        user.isAway = true;
        user.awayMessage = message;
        user.send(this.host, irc.reply.nowAway, user.nick, ':You have been marked as being away');
      }
    },

    VERSION: function(user, server) {
      // TODO: server
      user.send(this.host,
                irc.reply.version,
                user.nick,
                this.version + '.' + (this.debug ? 'debug' : ''),
                this.config.hostname, ':' + this.config.name);
    },

    TIME: function(user, server) {
      // TODO: server
      user.send(this.host, irc.reply.time, user.nick, this.config.hostname, ':' + (new Date()));
    },

    NICK: function(user, nick) {
      var oldMask = user.mask;

      if (!nick || nick.length === 0) {
        return user.send(this.host, irc.errors.noNickGiven, ':No nickname given');
      } else if (nick === user.nick) {
        return;
      } else if (nick.length > 9 || nick.match(irc.validations.invalidNick)) {
        return user.send(this.host, irc.errors.badNick, (user.nick || ''), nick, ':Erroneus nickname');
      } else if (this.valueExists(nick, this.users.registered, 'nick')) {
        return user.send(this.host, irc.errors.nameInUse, '*', nick, ':is already in use');
      }

      user.channels.forEach(function(channel) {
        channel.send(user.mask, 'NICK', ':' + nick);
      });

      user.nick = nick.trim();
      user.register();
    },

    USER: function(user, username, hostname, servername, realname) {
      this.users.register(user, username, hostname, servername, realname);
    },

    JOIN: function(user, channelNames) {
      var server = this;
      channelNames.split(',').forEach(function(args) {
        var nameParts = args.split(' '),
            channelName = nameParts[0],
            key = nameParts[1];
        if (!server.channelTarget(channelName)
            || channelName.match(irc.validations.invalidChannel)) {
          user.send(server.host, irc.errors.noSuchChannel, ':No such channel');
        } else {
          server.channels.join(user, channelName, key);
        }
      });
    },

    // TODO: this can accept multiple channels according to the spec
    PART: function(user, channelName, partMessage) {
      var channel = this.channels.find(channelName);
      if (channel && user.channels.indexOf(channel) !== -1) {
        partMessage = partMessage ? ' :' + partMessage : '';
        channel.send(user.mask, 'PART', channelName + partMessage);
        channel.part(user);
      }
    },

    KICK: function(user, channels, users, kickMessage) {
      var channelMasks = channels.split(','),
          userNames = users.split(','),
          server = this;

      kickMessage = kickMessage ? ':' + kickMessage : ':' + user.nick;

      // ERR_BADCHANMASK

      if (userNames.length !== channelMasks.length) {
        user.send(this.host, irc.errors.needMoreParams, user.nick, ':Need more parameters');
      } else {
        channelMasks.forEach(function(channelMask, i) {
          var channel = server.channels.findWithMask(channelMask),
              userName = userNames[i],
              targetUser;

          if (!channel) {
            user.send(server.host, irc.errors.noSuchChannel, ':No such channel');
            return;
          }

          targetUser = channel.findUserNamed(userName);

          if (!channel.findUserNamed(user.nick)) {
            user.send(server.host, irc.errors.notOnChannel, user.nick, channel.name, ':Not on channel');
          } else if (!targetUser) {
            user.send(server.host, irc.errors.userNotInChannel, userName, channel.name, ':User not in channel');
          } else if (!user.isOp(channel)) {
            user.send(server.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You're not channel operator");
          } else {
            channel.send(user.mask, 'KICK', channel.name, targetUser.nick, kickMessage);
            channel.part(targetUser);
          }
        });
      }
    },

    TOPIC: function(user, channelName, topic) {
      var channel = this.channels.find(channelName);

      if (!channel) {
        user.send(this.host, irc.errors.noSuchNick, user.nick, channelName, ':No such nick/channel');
      } else {
        if (channel.modes.indexOf('t') === -1 || user.isOp(channel)) {
          channel.topic = topic;
          channel.send(user.mask, 'TOPIC', channel.name, ':' + topic);
        } else {
          user.send(this.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You're not channel operator");
        }
      }
    },

    // TODO: The RFC says the sender nick and actual user nick should be checked
    // TODO: Message validation
    PRIVMSG: function(user, target, message) {
      // ERR_NOTOPLEVEL
      // ERR_WILDTOPLEVEL
      // ERR_TOOMANYTARGETS
      // ERR_NOSUCHNICK
      // RPL_AWAY
      if (!target || target.length === 0) {
        user.send(this.host, irc.errors.noRecipient, ':No recipient given');
      } else if (!message || message.length === 0) {
        user.send(this.host, irc.errors.noTextToSend, ':No text to send');
      } else if (this.channelTarget(target)) {
        var channel = this.channels.find(target);
        if (channel.isModerated && !user.isVoiced(channel)) {
          user.send(this.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
        } else if (user.channels.indexOf(channel) === -1) {
          if (channel.modes.indexOf('n') !== -1) {
            user.send(this.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
            return;
          }
        } else {
          this.channels.message(user, channel, message);
        }
      } else {
        user.message(target, message);
      }
    },

    INVITE: function(user, nick, channelName) {
      var channel = this.channels.find(channelName),
          targetUser = this.users.find(nick);

      // TODO: Can this accept multiple channel names?
      // TODO: ERR_NOTONCHANNEL
      if (!targetUser) {
        user.send(this.host, irc.errors.noSuchNick, user.nick, nick, ':No such nick/channel');
        return;
      } else if (channel) {
        if (channel.isInviteOnly && !user.isOp(channel)) {
          user.send(this.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You're not channel operator");
          return;
        } else if (channel.onInviteList(targetUser)) {
          user.send(this.host, irc.errors.userOnChannel, user.nick, targetUser.nick, ':User is already on that channel');
          return;
        }
      } else if (!this.channelTarget(channelName)) {
        // Invalid channel
        return;
      } else {
        // TODO: Make this a register function
        // Create the channel
        channel = this.channels.registered[this.normalizeName(channelName)] = new Channel(channelName, this);
      }

      user.send(this.host, irc.reply.inviting, user.nick, targetUser.nick, channelName);
      targetUser.send(user.mask, 'INVITE', targetUser.nick, ':' + channelName);

      // TODO: How does an invite list get cleared?
      channel.inviteList.push(targetUser.nick);
    },

    MODE: function(user, target, modes, arg) {
      // TODO: This should work with multiple parameters, like the definition:
      // <channel> {[+|-]|o|p|s|i|t|n|b|v} [<limit>] [<user>] [<ban mask>]
      // o - give/take channel operator privileges                   [done]
      // p - private channel flag                                    [done]
      // s - secret channel flag;                                    [done] - what's the difference?
      // i - invite-only channel flag;                               [done] 
      // t - topic settable by channel operator only flag;           [done]
      // n - no messages to channel from clients on the outside;     [done]
      // m - moderated channel;                                      [done]
      // l - set the user limit to channel;                          [done]
      // b - set a ban mask to keep users out;                       [done]
      // v - give/take the ability to speak on a moderated channel;  [done]
      // k - set a channel key (password).                           [done]

      // User modes
      // a - user is flagged as away;                                [done]
      // i - marks a users as invisible;                             [done]
      // w - user receives wallops;                                  [done]
      // r - restricted user connection;
      // o - operator flag;
      // O - local operator flag;
      // s - marks a user for receipt of server notices.
      var server = this;

      if (this.channelTarget(target)) {
        var channel = this.channels.find(target);
        if (!channel) {
          // TODO: Error
        } else if (modes) {
          if (modes[0] === '+') {
            channel.addModes(user, modes, arg);
          } else if (modes[0] === '-') {
            channel.removeModes(user, modes, arg);
          } else if (modes === 'b') {
            channel.banned.forEach(function(ban) {
              user.send(server.host, irc.reply.banList, user.nick, channel.name, ban.mask, ban.user.nick, ban.timestamp);
            });
            user.send(this.host, irc.reply.endBan, user.nick, channel.name, ':End of Channel Ban List');
          }
        } else {
          user.send(this.host, irc.reply.channelModes, user.nick, channel.name, channel.modes);
        }
      } else {
        // TODO: Server user modes
        var targetUser = this.users.find(target);
        if (targetUser) {
          if (modes[0] === '+') {
            targetUser.addModes(user, modes, arg);
          } else if (modes[0] === '-') {
            targetUser.removeModes(user, modes, arg);
          }
        }
      }
    },

    LIST: function(user, targets) {
      // TODO: ERR_TOOMANYMATCHES
      // TODO: ERR_NOSUCHSERVER
      var server = this,
          channels = {};
      user.send(this.host, irc.reply.listStart, user.nick, 'Channel', ':Users  Name');
      if (targets) {
        targets = targets.split(',');
        targets.forEach(function(target) {
          var channel = server.channels.find(target);
          if (channel) {
            channels[channel.name] = channel;
          }
        });
      } else {
        channels = this.channels.registered;
      }

      for (var i in channels) {
        var channel = channels[i];
        // if channel is secret or private, ignore
        if (channel.isPublic || channel.isMember(user)) {
          user.send(this.host, irc.reply.list, user.nick, channel.name, channel.memberCount, ':[' + channel.modes + '] ' + channel.topic);
        }
      }

      user.send(this.host, irc.reply.listEnd, user.nick, ':End of /LIST');
    },

    // TODO: LIST
    NAMES: function(user, targets) {
      var server = this;
      if (targets) {
        targets = targets.split(',');
        targets.forEach(function(target) {
          // if channel is secret or private, ignore
          var channel = server.channels.find(target);
          if (channel && (channel.isPublic || channel.isMember(user))) {
            user.send(server.host, irc.reply.nameReply, user.nick, channel.type, channel.name, ':' + channel.names);
          }
        });
      }
      user.send(this.host, irc.reply.endNames, user.nick, '*', ':End of /NAMES list.'); 
    },

    WHO: function(user, target) {
      var server = this;

      if (this.channelTarget(target)) {
        // TODO: Channel wildcards
        var channel = this.channels.find(target);
        channel.users.forEach(function(channelUser) {
          if (channelUser.isInvisible
              && !user.isOper
              && channel.users.indexOf(user) === -1) {
              return;
          } else {
            user.send(server.host,
                      irc.reply.who,
                      user.nick,
                      channel.name,
                      channelUser.username,
                      channelUser.hostname,
                      server.config.hostname, // The IRC server rather than the network
                      channelUser.channelNick(channel),
                      'H', // TODO: H is here, G is gone, * is IRC operator, + is voice, @ is chanop
                      ':0',
                      channelUser.realname);
          }
        });
        user.send(this.host, irc.reply.endWho, user.nick, channel.name, ':End of /WHO list.');
      } else {
        var matcher = this.normalizeName(target).replace(/\?/g, '.');
        this.users.registered.forEach(function(targetUser) {
          try {
            if (!targetUser.nick.match('^' + matcher + '$')) return;
          } catch (e) {
            return;
          }

          var sharedChannel = targetUser.sharedChannelWith(user);
          if (targetUser.isInvisible
              && !user.isOper
              && !sharedChannel) {
              return;
          } else {
            user.send(server.host,
                      irc.reply.who,
                      user.nick,
                      sharedChannel ? sharedChannel.name : '',
                      targetUser.username,
                      targetUser.hostname,
                      server.config.hostname,
                      targetUser.channelNick(channel),
                      'H', // TODO
                      ':0',
                      targetUser.realname);
          }
        });
        user.send(this.host, irc.reply.endWho, user.nick, target, ':End of /WHO list.');
      }
    },

    WHOIS: function(user, nickmask) {
      // TODO: nick masks
      var target = this.users.find(nickmask);
      if (target) {
        var channels = target.channels.map(function(channel) {
          if (channel.isSecret && !channel.isMember(user)) return;

          if (target.isOp(channel)) {
            return '@' + channel.name;
          } else {
            return channel.name;
          }
        });

        user.send(this.host, irc.reply.whoIsUser, user.nick, target.nick,
                  target.username, target.hostname, '*', ':' + target.realname);
        user.send(this.host, irc.reply.whoIsChannels, user.nick, target.nick, ':' + channels);
        user.send(this.host, irc.reply.whoIsServer, user.nick, target.nick, this.config.hostname, ':' + this.config.serverDescription);
        if (target.isAway) {
          user.send(this.host, irc.reply.away, user.nick, target.nick, ':' + target.awayMessage);
        }
        user.send(this.host, irc.reply.whoIsIdle, user.nick, target.nick, target.idle, user.created, ':seconds idle, signon time');
        user.send(this.host, irc.reply.endOfWhoIs, user.nick, target.nick, ':End of /WHOIS list.');
      } else if (!nickmask || nickmask.length === 0) {
        user.send(this.host, irc.errors.noNickGiven, user.nick, ':No nick given');
      } else {
        user.send(this.host, irc.errors.noSuchNick, user.nick, nickmask, ':No such nick/channel');
      }
    },

    WHOWAS: function(user, nicknames, count, serverName) {
      // TODO: Server
      var server = this,
          found = false;
      nicknames.split(',').forEach(function(nick) {
        var matches = server.history.find(nick);
        if (count) matches = matches.slice(0, count);
        matches.forEach(function(item) {
          found = true;
          user.send(server.host, irc.reply.whoWasUser, user.nick, item.nick, item.username, item.host, '*', ':' + item.realname);
          user.send(server.host, irc.reply.whoIsServer, user.nick, item.nick, item.server, ':' + item.time);
        });
      });

      if (found) {
        user.send(this.host, irc.reply.endWhoWas, user.nick, nicknames, ':End of WHOWAS');
      } else {
        user.send(this.host, irc.errors.wasNoSuchNick, user.nick, nicknames, ':There was no such nickname');
      }
    },

    WALLOPS: function(user, text) {
      if (!text || text.length === 0) {
        user.send(this.host, irc.errors.needMoreParams, user.nick, ':Need more parameters');
        return;
      }

      this.users.registered.forEach(function(user) {
        if (user.modes.indexOf('w') !== -1) {
          user.send(this.host, 'WALLOPS', ':OPERWALL - ' + text);
        }
      });
    },

    // TODO: Local ops
    OPER: function(user, name, password) {
      if (!name || !password) {
        user.send(this.host, irc.errors.wasNoSuchNick, user.nick, ':OPER requires a nick and password');
      } else {
        var userConfig;
        for (var nick in this.config.opers) {
          // TODO: ERR_NOOPERHOST (noOperHost)
          if (sha1(password) === this.config.opers[nick].password) {
            user.send(this.host, irc.reply.youAreOper, user.nick, ':You are now an IRC operator');
            user.oper();
          } else {
            user.send(this.host, irc.errors.passwordWrong, user.nick, ':Password incorrect');
          }
        }
      }
    },

    QUIT: function(user, message) {
      user.quit(message);
      this.history.add(user);
      delete user;
    }
  },

  replyToLinkInitialization: function(server) {
    if (server.authenticated && server.gotServerInfo) {
      server.send('PASS', server.password, '0210010000', 'IRC|aBgH$');
      server.send('SERVER', this.name, '0', this.token, this.info || '');

      // TODO: Send all known servers
      // TODO: Send client information with NICK, NJOIN/MODE
      // TODO: Send SERVICE messages
      this.users.registered.forEach(function(user, i) {
        // TODO: hopcount
        // TODO: token
        server.send('NICK', user.nick, 0, user.username, user.hostname, i, user.modes, user.realname);
      });
    }
  },

  completeLinkConnection: function(server) {
    this.log('Link connection complete, but so what?');
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

    return {
      command: args[0].toUpperCase(),
      args: args.slice(1)
    };
  },

  listenForLinks: function() {
    var server = this,
        tcpServer;

    tcpServer = net.createServer(function(stream) {
      server.log('*** LINK CONNECTION');
      var remoteServer = server.servers.findByHost(stream.remoteAddress);
      try {
        var carry = carrier.carry(stream);

        // TODO: Server.ircVersion instead of 0210010000?
        // TODO: Modes
        // TODO: zlib link compression

        // Introduce peer to remote server
        // Introduce ourselves to the remote server
        remoteServer.stream = stream;
        remoteServer.send('PASS', remoteServer.password, '0210010000', 'IRC|aBgH$');
        // TODO: hopCount here?
        remoteServer.send('SERVER', server.name, '0', server.token, server.info || '');

        stream.on('end', function() {
          log('*** LINK END');
        });

        stream.on('error', function(error) {
          log('*** LINK ERROR: ' + error);
        });

        carry.on('line',  function(line) {
          line = line.slice(0, 512);
          log('LINK RX: [' + stream.remoteAddress + '] ' + line);

          var message = server.parse(line);
          if (server.serverCommands[message.command]) {
            message.args.unshift(remoteServer);
            return server.serverCommands[message.command].apply(server, message.args);
          }
        });
      } catch (exception) {
        log('Fatal error: ', exception);
      }
    });

    tcpServer.listen(this.config.linkPort);
  },

  registerLinks: function() {
    for (var serverName in this.config.links) {
      this.servers.register(serverName, this.config.links[serverName]);
    }
  },

  connectToLinks: function() {
    // TODO: Autoconnect
  },

  respond: function(data, client) {
    var message = this.parse(data);

    if (this.commands[message.command]) {
      message.args.unshift(client.object);
      return this.commands[message.command].apply(this, message.args);
    }
  },

  motd: function(user) {
    user.send(this.host, irc.reply.motdStart, user.nick, ':- Message of the Day -');
    user.send(this.host, irc.reply.motd, user.nick, ':-');
    user.send(this.host, irc.reply.motdEnd, user.nick, ':End of /MOTD command.');
  },

  start: function() {
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

    this.tcpServer.listen(this.config.port);
    this.listenForLinks();
    this.registerLinks();
    this.connectToLinks();
  },

  close: function() {
    this.tcpServer.close();
  },

  end: function(client) {
    var user = client.object;
    user.channels.forEach(function(channel) {
      channel.users.forEach(function(channelUser) {
        if (channelUser !== user) {
          channelUser.send(user.mask, 'QUIT', user.quitMessage);
        }
      });

      delete channel.users[channel.users.indexOf(user)];
    });

    this.users.remove(user);
    user = null;
  },

  error: function(error) {
    log('*** ERROR: ' + error);
  },

  data: function(client, line) {
    line = line.slice(0, 512);
    log('C: [' + client.id + '] ' + line);
    this.respond(line, client);
  }
};

exports.Server = Server;

if (!module.parent) {
  var server = new Server();

  if (!server.loadConfig()) {
    process.exit(1);
  }

  process.on('SIGHUP', function () {
    log('Reloading config...');
    server.loadConfig();
  });

  server.start();
}

