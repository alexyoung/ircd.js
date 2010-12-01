var irc = require('./protocol'),
    Server;

function Channel(name, ircServer) {
  Server = ircServer;
  this.name = name;
  this.users = [];
  this.topic = '';
  this._modes = ['n', 't', 'r'];
  this.banned = [];
  this.userLimit = 0;
  this.key = null;
  this.inviteList = [];

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

  this.__defineGetter__('isInviteOnly', function() {
    return this._modes.indexOf('i') > -1;
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
  onInviteList: function(user) {
    var userNick = Server.normalizeName(user.nick);
    return this.inviteList.some(function(nick) {
      return Server.normalizeName(nick) === userNick;
    });
  },

  isValidKey: function(key) {
    return key && key.length > 1 && key.length < 9 && !key.match(irc.validations.invalidChannelKey);
  },

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
        Server.log('Error writing to stream:');
        Server.log(exception);
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
        this.modes += mode;
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

    i: function(user, arg) {
      this.opModeAdd('i', user, arg);
    },

    k: function(user, arg) {
      if (user.isOp(this)) {
        if (this.key) {
          user.send(irc.host, irc.errors.keySet, user.nick, this.name, ":Channel key already set");
        } else if (this.isValidKey(arg)) {
          this.key = arg;
          this.modes += 'k';
          this.send(user.mask, 'MODE', this.name, '+k ' + arg);
        } else {
          // TODO: I thought 475 was just returned when joining the channel
          user.send(irc.host, irc.errors.badChannelKey, user.nick, this.name, ":Invalid channel key");
        }
      } else {
        user.send(irc.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
      }
    },

    l: function(user, arg) {
      if (user.isOp(this)) {
        var limit = parseInt(arg, 10);
        if (this.userLimit != limit) {
          this.modes += 'l';
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

    i: function(user, arg) {
      this.opModeRemove('i', user, arg);
    },

    k: function(user, arg) {
      if (this.opModeRemove('k', user, arg)) {
        this.key = null;
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

exports.Channel = Channel;
