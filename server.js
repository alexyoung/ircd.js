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
    tcpServer,
    Server;

// TODO: Proper logging
function log(m) {
  if (Server.showLog) {
    console.log.apply(this, Array.prototype.slice.call(arguments));
  }
}

Server = {
  name: 'ircd.js',
  version: '0.1',
  created: '2010-10-20',
  debug: false,
  showLog: true,
  log: log,

  loadConfig: function() {
    try {
      this.config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.js')).toString());
      irc.host = ':' + this.config.hostname;      
      return true;
    } catch (exception) {
      log('Please ensure you have a valid config file:');
      log(exception);
    }
    return false;
  },

  users: {
    registered: [],

    register: function(user, username, hostname, servername, realname) {
      user.username = username;
      user.realname = realname;
      this.registered.push(user);
      user.register();
    },

    find: function(nick) {
      nick = Server.normalizeName(nick);
      for (var i = 0; i < this.registered.length; i++) {
        if (Server.normalizeName(this.registered[i].nick) === nick)
          return this.registered[i];
      }
    },

    remove: function(user) {
      delete this.registered[this.registered.indexOf(user)];
    }
  },

  channels: {
    registered: {},

    message: function(user, channel, message) {
      if (!channel) return;

      channel.users.forEach(function(channelUser) {
        if (channelUser !== user) {
          channelUser.send(user.mask, 'PRIVMSG', channel.name, ':' + message);
        }
      });
    },

    expandMask: function(mask) {
      return mask.replace(/\./g, '\\.').
                  replace(/\*/g, '.*');
    },

    findWithMask: function(channelMask) {
      channelMask = this.expandMask(Server.normalizeName(channelMask));
      for (var channelName in this.registered) {
        if (channelMask.match(channelName)) {
          return this.registered[channelName];
        }
      }
    },

    find: function(channelName) {
      return this.registered[Server.normalizeName(channelName)];
    },

    join: function(user, channelName, key) {
      // TODO: valid channel name?
      // Channels names are strings (beginning with a '&' or '#' character) of
      // length up to 200 characters.  Apart from the the requirement that the
      // first character being either '&' or '#'; the only restriction on a
      // channel name is that it may not contain any spaces (' '), a control G
      // (^G or ASCII 7), or a comma (',' which is used as a list item
      // separator by the protocol).

      var channel = this.find(channelName);

      if (!channel) {
        channel = this.registered[Server.normalizeName(channelName)] = new Channel(channelName, Server);
        user.op(channel);
      }

      if (channel.isInviteOnly && !channel.onInviteList(user)) {
        user.send(irc.host, irc.errors.inviteOnly, user.nick, channel.name, ':Cannot join channel (+i)');
        return;
      }

      if (channel.isBanned(user)) {
        user.send(irc.host, irc.errors.banned, user.nick, channel.name, ':Cannot join channel (+b)');
        return;
      }

      if (channel.isLimited && channel.users.length >= channel.userLimit) {
        user.send(irc.host, irc.errors.channelIsFull, user.nick, channel.name, ':Channel is full.');
        return;
      }

      if (channel.key) {
        if (key !== channel.key) {
          user.send(irc.host, irc.errors.badChannelKey, user.nick, this.name, ":Invalid channel key");
          return;
        }
      }

      channel.users.push(user);
      user.channels.push(channel);

      channel.users.forEach(function(channelUser) { 
        channelUser.send(user.mask, 'JOIN', channel.name);
      });

      if (channel.topic) {
        user.send(irc.host, irc.reply.topic, user.nick, channel.name, ':' + channel.topic);
      } else {
        user.send(irc.host, irc.reply.noTopic, user.nick, channel.name, ':No topic is set');
      }

      user.send(irc.host, irc.reply.nameReply, user.nick, channel.type, channel.name, ':' + channel.names);
      user.send(irc.host, irc.reply.endNames, user.nick, channel.name, ':End of /NAMES list.');
    }
  },

  history: {
    items: [],

    add: function(user) {
      this.items.unshift({ nick: user.nick,
                           username: user.username,
                           realname: user.realname,
                           host: user.hostname,
                           server: user.server,
                           time: new Date() });
      this.items.slice(0, Server.config.whoWasLimit);
    },

    find: function(nick) {
      return this.items.filter(function(item) {
        return nick === item.nick;
      });
    }
  },

  commands: {
    PING: function(user, hostname) {
      user.send(irc.host, 'PONG', Server.config.hostname, irc.host);
    },

    // TODO: Does this come from other servers in the network?
    PONG: function(user, hostname) {
      user.send('PING', hostname);
    },

    AWAY: function(user, message) {
      if (user.isAway && (!message || message.length === 0)) {
        user.isAway = false;
        user.awayMessage = null;
        user.send(irc.host, irc.reply.unaway, user.nick, ':You are no longer marked as being away');
      } else {
        user.isAway = true;
        user.awayMessage = message;
        user.send(irc.host, irc.reply.nowAway, user.nick, ':You have been marked as being away');
      }
    },

    VERSION: function(user, server) {
      // TODO: server
      user.send(irc.host,
                irc.reply.version,
                user.nick,
                Server.version + '.' + (Server.debug ? 'debug' : ''),
                Server.config.hostname, ':' + Server.name);
    },

    TIME: function(user, server) {
      // TODO: server
      user.send(irc.host, irc.reply.time, user.nick, Server.config.hostname, ':' + (new Date()));
    },

    NICK: function(user, nick) {
      var oldMask = user.mask;

      if (!nick || nick.length === 0) {
        return user.send(irc.host, irc.errors.noNickGiven, ':No nickname given');
      } else if (nick === user.nick) {
        return;
      } else if (nick.length > 9 || nick.match(irc.validations.invalidNick)) {
        return user.send(irc.host, irc.errors.badNick, (user.nick || ''), nick, ':Erroneus nickname');
      } else if (this.valueExists(nick, this.users.registered, 'nick')) {
        return user.send(irc.host, irc.errors.nameInUse, '*', nick, ':is already in use');
      }

      user.channels.forEach(function(channel) {
        channel.send(user.mask, 'NICK', ':' + nick);
      });

      user.nick = nick.trim();
      user.register();
    },

    USER: function(user, username, hostname, servername, realname) {
      Server.users.register(user, username, hostname, servername, realname);
    },

    JOIN: function(user, channelNames) {
      channelNames.split(',').forEach(function(args) {
        var nameParts = args.split(' '),
            channelName = nameParts[0],
            key = nameParts[1];
        if (!Server.channelTarget(channelName)
            || channelName.match(irc.validations.invalidChannel)) {
          user.send(irc.host, irc.errors.noSuchChannel, ':No such channel');
        } else {
          Server.channels.join(user, channelName, key);
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
          userNames = users.split(',');

      kickMessage = kickMessage ? ':' + kickMessage : ':' + user.nick;

      // ERR_BADCHANMASK

      if (userNames.length !== channelMasks.length) {
        user.send(irc.host, irc.errors.needMoreParams, user.nick, ':Need more parameters');
      } else {
        channelMasks.forEach(function(channelMask, i) {
          var channel = Server.channels.findWithMask(channelMask),
              userName = userNames[i],
              targetUser;

          if (!channel) {
            user.send(irc.host, irc.errors.noSuchChannel, ':No such channel');
            return;
          }

          targetUser = channel.findUserNamed(userName);

          if (!channel.findUserNamed(user.nick)) {
            user.send(irc.host, irc.errors.notOnChannel, user.nick, channel.name, ':Not on channel');
          } else if (!targetUser) {
            user.send(irc.host, irc.errors.userNotInChannel, userName, channel.name, ':User not in channel');
          } else if (!user.isOp(channel)) {
            user.send(irc.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You're not channel operator");
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
        user.send(irc.host, irc.errors.noSuchNick, user.nick, channelName, ':No such nick/channel');
      } else {
        if (channel.modes.indexOf('t') === -1 || user.isOp(channel)) {
          channel.topic = topic;
          channel.send(user.mask, 'TOPIC', channel.name, ':' + topic);
        } else {
          user.send(irc.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You're not channel operator");
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
        user.send(irc.host, irc.errors.noRecipient, ':No recipient given');
      } else if (!message || message.length === 0) {
        user.send(irc.host, irc.errors.noTextToSend, ':No text to send');
      } else if (Server.channelTarget(target)) {
        var channel = this.channels.find(target);
        if (channel.isModerated && !user.isVoiced(channel)) {
          user.send(irc.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
        } else if (user.channels.indexOf(channel) === -1) {
          if (channel.modes.indexOf('n') !== -1) {
            user.send(irc.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
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
        user.send(irc.host, irc.errors.noSuchNick, user.nick, nick, ':No such nick/channel');
        return;
      } else if (channel) {
        if (channel.isInviteOnly && !user.isOp(channel)) {
          user.send(irc.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You're not channel operator");
          return;
        } else if (channel.onInviteList(targetUser)) {
          user.send(irc.host, irc.errors.userOnChannel, user.nick, targetUser.nick, ':User is already on that channel');
          return;
        }
      } else if (!Server.channelTarget(channelName)) {
        // Invalid channel
        return;
      } else {
        // TODO: Make this a register function
        // Create the channel
        channel = this.channels.registered[Server.normalizeName(channelName)] = new Channel(channelName, Server);
      }

      user.send(irc.host, irc.reply.inviting, user.nick, targetUser.nick, channelName);
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
      // w - user receives wallops;
      // r - restricted user connection;
      // o - operator flag;
      // O - local operator flag;
      // s - marks a user for receipt of server notices.

      if (Server.channelTarget(target)) {
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
              user.send(irc.host, irc.reply.banList, user.nick, channel.name, ban.mask, ban.user.nick, ban.timestamp);
            });
            user.send(irc.host, irc.reply.endBan, user.nick, channel.name, ':End of Channel Ban List');
          }
        } else {
          user.send(irc.host, irc.reply.channelModes, user.nick, channel.name, channel.modes);
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
      user.send(irc.host, irc.reply.listStart, user.nick, 'Channel', ':Users  Name');
      var channels = {};
      if (targets) {
        targets = targets.split(',');
        targets.forEach(function(target) {
          var channel = Server.channels.find(target);
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
          user.send(irc.host, irc.reply.list, user.nick, channel.name, channel.memberCount, ':[' + channel.modes + '] ' + channel.topic);
        }
      }

      user.send(irc.host, irc.reply.listEnd, user.nick, ':End of /LIST');
    },

    // TODO: LIST
    NAMES: function(user, targets) {
      if (targets) {
        targets = targets.split(',');
        targets.forEach(function(target) {
          // if channel is secret or private, ignore
          var channel = Server.channels.find(target);
          if (channel && (channel.isPublic || channel.isMember(user))) {
            user.send(irc.host, irc.reply.nameReply, user.nick, channel.type, channel.name, ':' + channel.names);
          }
        });
      }
      user.send(irc.host, irc.reply.endNames, user.nick, '*', ':End of /NAMES list.'); 
    },

    WHO: function(user, target) {
      if (Server.channelTarget(target)) {
        // TODO: Channel wildcards
        var channel = this.channels.find(target);
        channel.users.forEach(function(channelUser) {
          if (channelUser.isInvisible
              && !user.isOper
              && channel.users.indexOf(user) === -1) {
              return;
          } else {
            user.send(irc.host,
                      irc.reply.who,
                      user.nick,
                      channel.name,
                      channelUser.username,
                      channelUser.hostname,
                      Server.config.hostname, // The IRC server rather than the network
                      channelUser.channelNick(channel),
                      'H', // TODO: H is here, G is gone, * is IRC operator, + is voice, @ is chanop
                      ':0',
                      channelUser.realname);
          }
        });
        user.send(irc.host, irc.reply.endWho, user.nick, channel.name, ':End of /WHO list.');
      } else {
        var matcher = Server.normalizeName(target).replace(/\?/g, '.');
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
            user.send(irc.host,
                      irc.reply.who,
                      user.nick,
                      sharedChannel ? sharedChannel.name : '',
                      targetUser.username,
                      targetUser.hostname,
                      Server.config.hostname,
                      targetUser.channelNick(channel),
                      'H', // TODO
                      ':0',
                      targetUser.realname);
          }
        });
        user.send(irc.host, irc.reply.endWho, user.nick, target, ':End of /WHO list.');
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

        user.send(irc.host, irc.reply.whoIsUser, user.nick, target.nick,
                  target.username, target.hostname, '*', ':' + target.realname);
        user.send(irc.host, irc.reply.whoIsChannels, user.nick, target.nick, ':' + channels);
        user.send(irc.host, irc.reply.whoIsServer, user.nick, target.nick, Server.config.hostname, ':' + Server.config.serverDescription);
        if (target.isAway) {
          user.send(irc.host, irc.reply.away, user.nick, target.nick, ':' + target.awayMessage);
        }
        user.send(irc.host, irc.reply.whoIsIdle, user.nick, target.nick, target.idle, user.created, ':seconds idle, signon time');
        user.send(irc.host, irc.reply.endOfWhoIs, user.nick, target.nick, ':End of /WHOIS list.');
      } else if (!nickmask || nickmask.length === 0) {
        user.send(irc.host, irc.errors.noNickGiven, user.nick, ':No nick given');
      } else {
        user.send(irc.host, irc.errors.noSuchNick, user.nick, nickmask, ':No such nick/channel');
      }
    },

    WHOWAS: function(user, nicknames, count, server) {
      // TODO: Server
      var found = false;
      nicknames.split(',').forEach(function(nick) {
        var matches = Server.history.find(nick);
        if (count) matches = matches.slice(0, count);
        matches.forEach(function(item) {
          found = true;
          user.send(irc.host, irc.reply.whoWasUser, user.nick, item.nick, item.username, item.host, '*', ':' + item.realname);
          user.send(irc.host, irc.reply.whoIsServer, user.nick, item.nick, item.server, ':' + item.time);
        });
      });

      if (found) {
        user.send(irc.host, irc.reply.endWhoWas, user.nick, nicknames, ':End of WHOWAS');
      } else {
        user.send(irc.host, irc.errors.wasNoSuchNick, user.nick, nicknames, ':There was no such nickname');
      }
    },

    // TODO: Local ops
    OPER: function(user, name, password) {
      if (!name || !password) {
        user.send(irc.host, irc.errors.wasNoSuchNick, user.nick, ':OPER requires a nick and password');
      } else {
        var userConfig;
        for (var nick in Server.config.opers) {
          // TODO: ERR_NOOPERHOST (noOperHost)
          if (sha1(password) === Server.config.opers[nick].password) {
            user.send(irc.host, irc.reply.youAreOper, user.nick, ':You are now an IRC operator');
            user.oper();
          } else {
            user.send(irc.host, irc.errors.passwordWrong, user.nick, ':Password incorrect');
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

  respond: function(data, user) {
    // IRC messages are always lines of characters terminated with a CR-LF
    // (Carriage Return - Line Feed) pair, and these messages shall not
    // exceed 512 characters in length, counting all characters including
    // the trailing CR-LF. Thus, there are 510 characters maximum allowed
    // for the command and its parameters.  There is no provision for
    // continuation message lines.  See section 7 for more details about
    // current implementations.

    var message = this.parse(data);
    if (Server.commands[message.command]) {
      message.args.unshift(user);
      return Server.commands[message.command].apply(this, message.args);
    }
    // TODO: invalid command or message?
  },

  motd: function(user) {
    user.send(irc.host, irc.reply.motdStart, user.nick, ':- Message of the Day -');
    user.send(irc.host, irc.reply.motd, user.nick, ':-');
    user.send(irc.host, irc.reply.motdEnd, user.nick, ':End of /MOTD command.');
  }
};

if (!Server.loadConfig()) {
  process.exit(1);
}

process.on('SIGHUP', function () {
  log('Reloading config...');
  Server.loadConfig();
});

tcpServer = net.createServer(function(stream) {
  try {
    var carry = carrier.carry(stream),
        user = new User(stream, Server);

    stream.on('end', function() {
      user.channels.forEach(function(channel) {
        channel.users.forEach(function(channelUser) {
          if (channelUser !== user) {
            channelUser.send(user.mask, 'QUIT', user.quitMessage);
          }
        });

        delete channel.users[channel.users.indexOf(user)];
      });

      Server.users.remove(user);
      user = null;
    });

    stream.on('error', function(error) {
      log('*** ERROR: ' + error);
    });

    carry.on('line',  function(line) {
      line = line.slice(0, 512);
      log('C: [' + user.nick + '] ' + line);
      Server.respond(line, user);
    });
  } catch (exception) {
    log('Fatal error: ', exception);
  }
});

tcpServer.listen(6667);
exports.tcpServer = tcpServer;
exports.ircServer = Server;
