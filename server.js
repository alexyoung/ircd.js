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
    events = require('events'),
    dns = require('dns'),
    fs = require('fs'),
    irc = require('./protocol'),
    path = require('path'),
    tcpServer,
    Server,
    config;

// TODO: Proper logging
function log(m) {
  if (Server.showLog) {
    console.log(m);
  }
}

Server = {
  name: 'IRCN',
  version: '0.1',
  created: '2010-10-20',
  showLog: true,

  config: {
    load: function() {
      try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.js')).toString());
        irc.host = ':' + config.hostname;      
        return true;
      } catch (exception) {
        log('Please ensure you have a valid config file:');
        log(exception);
      }
      return false;
    }
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

    find: function(channelName) {
      return this.registered[Server.normalizeName(channelName)];
    },

    join: function(user, channelName) {
      // TODO: valid channel name?
      // Channels names are strings (beginning with a '&' or '#' character) of
      // length up to 200 characters.  Apart from the the requirement that the
      // first character being either '&' or '#'; the only restriction on a
      // channel name is that it may not contain any spaces (' '), a control G
      // (^G or ASCII 7), or a comma (',' which is used as a list item
      // separator by the protocol).

      var channel = this.find(channelName);

      if (!channel) {
        channel = this.registered[Server.normalizeName(channelName)] = new Channel(channelName);
        user.op(channel);
      }

      if (channel.isBanned(user)) {
        user.send(irc.host, irc.errors.banned, user.nick, channel.name, ':Cannot join channel (+b)');
        return;
      }

      if (channel.isLimited && channel.users.length >= channel.userLimit) {
        user.send(irc.host, irc.errors.channelIsFull, user.nick, channel.name, ':Channel is full.');
        return;
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

  commands: {
    PING: function(user, hostname) {
      user.send(irc.host, 'PONG', config.hostname, irc.host);
    },

    // TODO: Does this come from other servers in the network?
    PONG: function(user, hostname) {
      user.send('PING', hostname);
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
      channelNames.split(',').forEach(function(channelName) {
        if (!Server.channelTarget(channelName)
            || channelName.match(irc.validations.invalidChannel)) {
          user.send(irc.host, irc.errors.noSuchChannel, ':No such channel');
        } else {
          Server.channels.join(user, channelName);
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

    MODE: function(user, target, modes, arg) {
      // <channel> {[+|-]|o|p|s|i|t|n|b|v} [<limit>] [<user>] [<ban mask>]
      // o - give/take channel operator privileges                   [done]
      // p - private channel flag                                    [done]
      // s - secret channel flag;                                    [done] - what's the difference?
      // i - invite-only channel flag;                               
      // t - topic settable by channel operator only flag;           [done]
      // n - no messages to channel from clients on the outside;     [done]
      // m - moderated channel;                                      [done]
      // l - set the user limit to channel;                          [done]
      // b - set a ban mask to keep users out;                       [done]
      // v - give/take the ability to speak on a moderated channel;  [done]
      // k - set a channel key (password).

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
        // TODO: Wildcards
        // TODO: hidden user mode
        var channel = this.channels.find(target);
        channel.users.forEach(function(channelUser) {
          user.send(irc.host,
                    irc.reply.who,
                    user.nick,
                    channel.name,
                    channelUser.username,
                    channelUser.hostname,
                    config.hostname, // The IRC server rather than the network
                    channelUser.channelNick(channel),
                    'H', // TODO: H is here, G is gone, * is IRC operator, + is voice, @ is chanop
                    ':0',
                    channelUser.realname);
        });
        user.send(irc.host, irc.reply.endWho, user.nick, channel.name, ':End of /WHO list.');
      } else {
        // TODO: User
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
        user.send(irc.host, irc.reply.whoIsServer, user.nick, target.nick, config.hostname, ':' + config.serverDescription);
        user.send(irc.host, irc.reply.whoIsIdle, user.nick, target.nick, target.idle, user.created, ':seconds idle, signon time');
        user.send(irc.host, irc.reply.endOfWhoIs, user.nick, target.nick, ':End of /WHOIS list.');
      } else if (!nickmask || nickmask.length === 0) {
        user.send(irc.host, irc.errors.noNickGiven, user.nick, ':No nick given');
      } else {
        user.send(irc.host, irc.errors.noSuchNick, user.nick, nickmask, ':No such nick/channel');
      }
    },

    QUIT: function(user, message) {
      user.quit(message);
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

function Channel(name) {
  this.name = name;
  this.users = [];
  this.topic = '';
  this._modes = ['n', 't', 'r'];
  this.banned = [];
  this.userLimit = 0;

  this.__defineGetter__('modes', function() {
    return '+' + this._modes.join(''); 
  });

  this.__defineSetter__('modes', function(modes) {
    this._modes = modes.split('');
  });

  this.__defineGetter__('memberCount', function() {
    return this.users.length;
  });

  this.__defineGetter__('isLimited', function() {
    return this._modes.indexOf('l') > -1;
  });

  this.__defineGetter__('isPublic', function() {
    return !this.isSecret && !this.isPrivate;
  });

  this.__defineGetter__('isSecret', function() {
    return this._modes.indexOf('s') > -1;
  });

  this.__defineGetter__('isPrivate', function() {
    return this._modes.indexOf('p') > -1;
  });

  this.__defineGetter__('isModerated', function() {
    return this._modes.indexOf('m') > -1;
  });

  this.__defineGetter__('names', function() {
    var channel = this;
    return this.users.map(function(user) {
      return user.channelNick(channel);
    }).join(' ');
  });

  this.__defineGetter__('type', function() {
    if (this.isPrivate) {
      return '*';
    } else if (this.isSecret) {
      return '@';
    } else {
      return '=';
    }
  });
}

Channel.prototype = {
  isBanned: function(user) {
    return this.banned.some(function(ban) {
      return user.matchesMask(ban.mask);
    });
  },

  banMaskExists: function(mask) {
    return this.banned.some(function(ban) {
      return ban.mask === mask;
    });
  },

  findBan: function(mask) {
    for (var i in this.banned) {
      if (this.banned[i].mask === mask) {
        return this.banned[i];
      }
    }
  },

  send: function() {
    var message = arguments.length === 1 ? arguments[0] : Array.prototype.slice.call(arguments).join(' ');

    this.users.forEach(function(user) {
      try {
        user.send(message);
      } catch (exception) {
        log('Error writing to stream:');
        log(exception);
      }
    });
  },

  findUserNamed: function(nick) {
    nick = Server.normalizeName(nick);
    for (var i = 0; i < this.users.length; i++) {
      if (Server.normalizeName(this.users[i].nick) === nick) {
        return this.users[i];
      }
    }
  },

  isMember: function(user) {
    return this.users.indexOf(user) !== -1;
  },

  addModes: function(user, modes, arg) {
    var channel = this;
    modes.slice(1).split('').forEach(function(mode) {
      if (channel.addMode[mode])
        channel.addMode[mode].apply(channel, [user, arg]);
    });
  },

  opModeAdd: function(mode, user, arg) {
    if (user.isOp(this)) {
      if (this.modes.indexOf(mode) === -1) {
        this.modes = this.modes + mode;
        this.send(user.mask, 'MODE', this.name, '+' + mode, this.name);
        return true;
      }
    } else {
      user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
    }
    return false;
  },

  opModeRemove: function(mode, user, arg) {
    if (user.isOp(this)) {
      if (this.modes.indexOf(mode) !== -1) {
        this.modes = this.modes.replace(mode, '');
        this.send(user.mask, 'MODE', this.name, '-' + mode, this.name);
        return true;
      }
    } else {
      user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
    }
    return false;
  },

  addMode: {
    o: function(user, arg) {
      if (user.isOp(this)) {
        var targetUser = this.findUserNamed(arg);
        if (targetUser && !targetUser.isOp(this)) {
          targetUser.op(this);
          this.send(user.mask, 'MODE', this.name, '+o', targetUser.nick);
        }
      } else {
        user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
      }
    },

    v: function(user, arg) {
      if (user.isOp(this)) {
        var targetUser = this.findUserNamed(arg);
        if (targetUser && !targetUser.isVoiced(this)) {
          targetUser.voice(this);
          this.send(user.mask, 'MODE', this.name, '+v', targetUser.nick);
        }
      } else {
        user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
      }
    },

    l: function(user, arg) {
      if (user.isOp(this)) {
        var limit = parseInt(arg, 10);
        if (this.userLimit != limit) {
          this.modes = this.modes + 'l';
          this.userLimit = limit;
          this.send(user.mask, 'MODE', this.name, '+l ' + arg, this.name);
        }
      } else {
        user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
      }
    },

    m: function(user, arg) {
      this.opModeAdd('m', user, arg);
    },

    n: function(user, arg) {
      this.opModeAdd('n', user, arg);
    },

    t: function(user, arg) {
      this.opModeAdd('t', user, arg);
    },

    p: function(user, arg) {
      this.opModeAdd('p', user, arg);
    },

    s: function(user, arg) {
      this.opModeAdd('s', user, arg);
    },

    b: function(user, arg) {
      if (user.isOp(this)) {
        // TODO: Valid ban mask?
        if (!this.banMaskExists(arg)) {
          this.banned.push({ user: user, mask: arg, timestamp: (new Date()).valueOf() });
          this.send(user.mask, 'MODE', this.name, '+b', ':' + arg);
        }
      } else {
        user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
      }
    }
  },

  removeModes: function(user, modes, arg) {
    var channel = this;
    modes.slice(1).split('').forEach(function(mode) {
      if (channel.removeMode[mode])
        channel.removeMode[mode].apply(channel, [user, arg]);
    });
  },

  removeMode: {
    o: function(user, arg) {
      if (user.isOp(this)) {
        var targetUser = this.findUserNamed(arg);
        if (targetUser && targetUser.isOp(this)) {
          targetUser.deop(this);
          this.send(user.mask, 'MODE', this.name, '-o', targetUser.nick);
        }
      } else {
        user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
      }
    },

    v: function(user, arg) {
      if (user.isOp(this)) {
        var targetUser = this.findUserNamed(arg);
        if (targetUser && targetUser.isVoiced(this)) {
          targetUser.devoice(this);
          this.send(user.mask, 'MODE', this.name, '-v', targetUser.nick);
        }
      } else {
        user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
      }
    },

    l: function(user, arg) {
      if (this.opModeRemove('l', user, arg, ' ' + arg)) {
        this.userLimit = 0;
      }
    },

    m: function(user, arg) {
      this.opModeRemove('m', user, arg);
    },

    n: function(user, arg) {
      this.opModeRemove('n', user, arg);
    },

    t: function(user, arg) {
      this.opModeRemove('t', user, arg);
    },

    p: function(user, arg) {
      this.opModeRemove('p', user, arg);
    },

    s: function(user, arg) {
      this.opModeRemove('s', user, arg);
    },

    b: function(user, arg) {
      if (user.isOp(this)) {
        // TODO: Valid ban mask?
        var ban = this.findBan(arg);
        if (ban) {
          delete this.banned[this.banned.indexOf(ban)];
          this.send(user.mask, 'MODE', this.name, '-b', ':' + arg);
        }
      } else {
        user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
      }
    }
  },

  part: function(user) {
    delete this.users[this.users.indexOf(user)];
    delete user.channels[user.channels.indexOf(this)];
    delete user.channelModes[this];
  }
};

function User(stream) {
  this.nick = null;
  this.username = null;
  this.realname = null;
  this.channels = [];
  this.quitMessage = 'Connection lost';
  this.remoteAddress = stream.remoteAddress;
  this.hostname = stream.remoteAddress;
  this.registered = false;
  this.stream = stream;
  this._modes = [];
  this.channelModes = {};
  this.created = new Date() / 1000;
  this.updated = new Date();
  this.__defineGetter__('mask', function() {
    return ':' + this.nick + '!' + this.username + '@' + this.hostname;
  });

  // TODO setter for modes
  this.__defineGetter__('modes', function() {
    return '+' + this._modes.join(''); 
  });

  this.__defineSetter__('modes', function(modes) {
    this._modes = modes.split('');
  });

  this.__defineGetter__('idle', function() {
    return parseInt(((new Date()) - this.updated) / 1000, 10)
  });

  this.hostLookup();
}

User.prototype = {
  send: function() {
    var message = arguments.length === 1 ?
        arguments[0]
      : Array.prototype.slice.call(arguments).join(' ');

    log('S: [' + this.nick + '] ' + message);
    try {
      this.stream.write(message + '\r\n');
    } catch (exception) {
      log(exception);
    }
  },

  expandMask: function(mask) {
    return mask.replace(/\./g, '\\.').
                replace(/\*/g, '.*');
  },

  matchesMask: function(mask) {
    var parts = mask.match(/([^!]*)!([^@]*)@(.*)/) || [],
        matched = true,
        lastPart = parts.length < 4 ? parts.length : 4;
    parts = parts.slice(1, lastPart).map(this.expandMask);

    if (!this.nick.match(parts[0])) {
      return false;
    } else if (!this.username.match(parts[1])) {
      return false;
    } else if (!this.hostname.match(parts[2])) {
      return false;
    } else {
      return true;
    }
  },

  channelNick: function(channel) {
    return this.isOp(channel) ? '@' + this.nick : this.nick;
  },

  isOp: function(channel) {
    if (this.channelModes[channel])
      return this.channelModes[channel].match(/o/);
  },

  op: function(channel) {
    this.channelModes[channel] += 'o';
  },

  deop: function(channel) {
    if (this.channelModes[channel])
      this.channelModes[channel] = this.channelModes[channel].replace(/o/, '');
  },

  isVoiced: function(channel) {
    if (this.channelModes[channel])
      return this.channelModes[channel].match(/v/) || this.isOp(channel);
  },

  voice: function(channel) {
    this.channelModes[channel] += 'v';
  },

  devoice: function(channel) {
    if (this.channelModes[channel])
      this.channelModes[channel] = this.channelModes[channel].replace(/v/, '');
  },

  hostLookup: function() {
    user = this;
    dns.reverse(this.remoteAddress, function(err, addresses) {
      user.hostname = addresses && addresses.length > 0 ? addresses[0] : user.remoteAddress;
    });
  },

  register: function() {
    if (this.registered === false
        && this.nick
        && this.username) {
      this.send(irc.host, irc.reply.welcome, this.nick, 'Welcome to the ' + config.network + ' IRC network', this.mask);
      this.send(irc.host, irc.reply.yourHost, this.nick, 'Your host is', config.hostname, 'running version', Server.version);
      this.send(irc.host, irc.reply.created, this.nick, 'This server was created on', Server.created);
      this.send(irc.host, irc.reply.myInfo, this.nick, Server.name, Server.version);
      Server.motd(this);
      this.registered = true;
    }
  },

  message: function(nick, message) {
    var user = Server.users.find(nick);
    this.updated = new Date();
    if (user) {
      user.send(this.mask, 'PRIVMSG', user.nick, ':' + message);
    } else {
      this.send(irc.host, irc.errors.noSuchNick, this.nick, nick, ':No such nick/channel');
    }
  },

  quit: function(message) {
    this.quitMessage = message;
    this.stream.end();
  }
};

if (!Server.config.load()) {
  process.exit(1);
}

process.on('SIGHUP', function () {
  log('Reloading config...');
  Server.config.load();
});

tcpServer = net.createServer(function(stream) {
  var carry = carrier.carry(stream),
      user = new User(stream);

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
});

tcpServer.listen(6667);
exports.tcpServer = tcpServer;
exports.ircServer = Server;
