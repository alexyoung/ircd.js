var dns = require('dns'),
    irc = require('./protocol');

function User(stream, ircServer) {
  Server = ircServer;
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
  this.server = '';
  this.created = new Date() / 1000;
  this.updated = new Date();
  this.isAway = false;
  this.awayMessage = null;
  this.serverOper = false;
  this.localOper = false;

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
    return parseInt(((new Date()) - this.updated) / 1000, 10);
  });

  this.__defineGetter__('isOper', function() {
    return this.serverOper || this.localOper;
  });

  this.__defineGetter__('isInvisible', function() {
    return this.modes.indexOf('i') !== -1;
  });

  this.hostLookup();
}

User.prototype = {
  send: function() {
    var message = arguments.length === 1 ?
        arguments[0]
      : Array.prototype.slice.call(arguments).join(' ');

    Server.log('S: [' + this.nick + '] ' + message);
    try {
      this.stream.write(message + '\r\n');
    } catch (exception) {
      Server.log(exception);
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

  sharedChannelWith: function(targetUser) {
    var user = this,
        channels = targetUser.channels,
        matchedChannel;
    channels.some(function(channel) {
      if (user.channels.indexOf(channel) !== -1) {
        matchedChannel = channel;
        return true;
      }
    });

    return matchedChannel;
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

  oper: function() {
    if (!this.modes.match(/o/)) {
      this._modes.push('o');
      this.send(this.mask, 'MODE', this.nick, '+o', this.nick);
    }
  },

  deoper: function() {
    this.removeMode.o.apply(this);
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
      this.server = Server.name;
      this.send(irc.host, irc.reply.welcome, this.nick, 'Welcome to the ' + Server.config.network + ' IRC network', this.mask);
      this.send(irc.host, irc.reply.yourHost, this.nick, 'Your host is', Server.config.hostname, 'running version', Server.version);
      this.send(irc.host, irc.reply.created, this.nick, 'This server was created on', Server.created);
      this.send(irc.host, irc.reply.myInfo, this.nick, Server.name, Server.version);
      Server.motd(this);
      this.registered = true;
      this.addMode.w.apply(this);
    }
  },

  message: function(nick, message) {
    var user = Server.users.find(nick);
    this.updated = new Date();

    if (user) {
      if (user.isAway) {
        this.send(irc.host, irc.reply.away, this.nick, user.nick, ':' + user.awayMessage);          
      }
      user.send(this.mask, 'PRIVMSG', user.nick, ':' + message);
    } else {
      this.send(irc.host, irc.errors.noSuchNick, this.nick, nick, ':No such nick/channel');
    }
  },

  addModes: function(user, modes, arg) {
    var thisUser = this;
    modes.slice(1).split('').forEach(function(mode) {
      if (thisUser.addMode[mode])
        thisUser.addMode[mode].apply(thisUser, [user, arg]);
    });
  },

  addMode: {
    i: function(user, arg) {
      if (this.isOper || this === user) {
        if (!user.modes.match(/i/)) {
          user._modes.push('i');
          user.send(user.mask, 'MODE', this.nick, '+i', user.nick);
          if (this !== user) {
            this.send(this.mask, 'MODE', this.nick, '+i', user.nick);
          }
        }
      } else {
        this.send(irc.host, irc.errors.usersDoNotMatch, this.nick, user.nick, ":Cannot change mode for other users");
      }
    },

    o: function() {
      // Can only be issued by OPER
    },

    w: function() {
      if (!this.modes.match(/w/)) {
        this._modes.push('w');
        this.send(this.mask, 'MODE', this.nick, '+w', this.nick);
      }
    }
  },

  removeModes: function(user, modes, arg) {
    var thisUser = this;
    modes.slice(1).split('').forEach(function(mode) {
      if (thisUser.removeMode[mode])
        thisUser.removeMode[mode].apply(thisUser, [user, arg]);
    });
  },

  removeMode: {
    i: function(user, arg) {
      if (this.isOper || this === user) {
        if (user.modes.match(/i/)) {
          delete user._modes[user._modes.indexOf('i')];
          user.send(user.mask, 'MODE', this.nick, '-i', user.nick);
          if (this !== user) {
            this.send(this.mask, 'MODE', this.nick, '-i', user.nick);
          }
        }
      } else {
        this.send(irc.host, irc.errors.usersDoNotMatch, this.nick, user.nick, ":Cannot change mode for other users");
      }
    },

    o: function() {
      if (this.modes.match(/o/)) {
        delete user._modes[user._modes.indexOf('o')];
        this.send(this.mask, 'MODE', this.nick, '-o', this.nick);
      }
    },

    w: function() {
      if (this.modes.match(/w/)) {
        delete user._modes[user._modes.indexOf('w')];
        this.send(this.mask, 'MODE', this.nick, '-w', this.nick);
      }
    }
  },

  quit: function(message) {
    this.quitMessage = message;
    this.stream.end();
  }
};

exports.User = User;
