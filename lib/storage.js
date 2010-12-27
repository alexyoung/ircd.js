var RemoteServer = require('./remote_server').RemoteServer,
    Channel = require('./channel').Channel,
    irc = require('./protocol');

function History(server) {
  this.server = server;
  this.config = server.config;
  this.items = [];
}

History.prototype = {
  add: function(user) {
    this.items.unshift({ nick: user.nick,
                         username: user.username,
                         realname: user.realname,
                         host: user.hostname,
                         server: user.serverName,
                         time: new Date() });
    if (this.config) {
      this.items.slice(0, this.config.whoWasLimit);
    }
  },

  find: function(nick) {
    return this.items.filter(function(item) {
      return nick === item.nick;
    });
  }
};

function UserDatabase(server) {
  this.server = server;
  this.config = server.config;
  this.registered = [];
}

UserDatabase.prototype = {
  push: function(user) {
    this.registered.push(user);
  },

  register: function(user, username, hostname, servername, realname) {
    user.username = username;
    user.realname = realname;
    this.registered.push(user);
    user.register();
  },

  find: function(nick) {
    nick = this.server.normalizeName(nick);
    for (var i = 0; i < this.registered.length; i++) {
      if (this.registered[i] && this.server.normalizeName(this.registered[i].nick) === nick)
        return this.registered[i];
    }
  },

  remove: function(user) {
    this.registered.splice(this.registered.indexOf(user), 1);
  }
};

function ChannelDatabase(server) {
  this.server = server;
  this.registered = {};
}

ChannelDatabase.prototype = {
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
    channelMask = this.expandMask(this.server.normalizeName(channelMask));
    for (var channelName in this.registered) {
      if (channelMask.match(channelName)) {
        return this.registered[channelName];
      }
    }
  },

  find: function(channelName) {
    return this.registered[this.server.normalizeName(channelName)];
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
      channel = this.registered[this.server.normalizeName(channelName)] = new Channel(channelName, this.server);
    }

    if (channel.isInviteOnly && !channel.onInviteList(user)) {
      user.send(this.server.host, irc.errors.inviteOnly, user.nick, channel.name, ':Cannot join channel (+i)');
      return;
    }

    if (channel.isBanned(user)) {
      user.send(this.server.host, irc.errors.banned, user.nick, channel.name, ':Cannot join channel (+b)');
      return;
    }

    if (channel.isLimited && channel.users.length >= channel.userLimit) {
      user.send(this.server.host, irc.errors.channelIsFull, user.nick, channel.name, ':Channel is full.');
      return;
    }

    if (channel.key) {
      if (key !== channel.key) {
        user.send(this.server.host, irc.errors.badChannelKey, user.nick, this.name, ":Invalid channel key");
        return;
      }
    }

    if (channel.users.length === 0) {
      user.op(channel);
    }

    channel.users.push(user);
    user.channels.push(channel);

    channel.users.forEach(function(channelUser) { 
      channelUser.send(user.mask, 'JOIN', channel.name);
    });

    if (channel.topic) {
      user.send(this.server.host, irc.reply.topic, user.nick, channel.name, ':' + channel.topic);
    } else {
      user.send(this.server.host, irc.reply.noTopic, user.nick, channel.name, ':No topic is set');
    }

    user.send(this.server.host, irc.reply.nameReply, user.nick, channel.type, channel.name, ':' + channel.names);
    user.send(this.server.host, irc.reply.endNames, user.nick, channel.name, ':End of /NAMES list.');
  }
};

function LinkDatabase(server) {
  this.registered = [];
  this.server = server;
}

LinkDatabase.prototype = {
  stringValue: function() {
    return this.registered.map(function(s) {
      var peer = s && s.peer ? s.peer.name : 'REMOTE';
      return peer + ' connected to ' + s.name;
    }).join('\n');
  },

  connectionExists: function(serverName, remoteName) {
    return this.registered.some(function(s) {
      return (s.peer.name == serverName && s.name == remoteName)
             || (s.peer.name == remoteName && s.name == serverName);
    });
  },

  register: function(serverName, options) {
    var remote = new RemoteServer(this.server, serverName, options);
    this.registered.push(remote);
    return remote;
  },

  registerRemote: function(linkServer, serverName, options) {
    if (!this.connectionExists(linkServer.name, serverName)) {
      var remote = new RemoteServer(linkServer, serverName, options);
      this.registered.push(remote);
      return remote;
    }
  },

  connect: function(targetServer, port, remoteServer) {
    // TODO: remoteServer
    this.registered.forEach(function(server) {
      if (server.name === targetServer) {
        server.attemptConnection();
      }
    });
  },

  findByHost: function(host) {
    var found;
    this.registered.some(function(server) {
      found = server;
      return server.host === host;
    });
    return found;
  },

  findByName: function(name) {
    var found;
    this.registered.some(function(server) {
      found = server;
      return server.name === name;
    });
    return found;
  },

  names: function() {
    return this.registered.map(function(s) {
      if (s.localConnection)
        return s.name;
    }).filter(function(name) { return name; });
  },

  each: function(fn) {
    return this.registered.forEach(fn);
  },

  broadcast: function() {
    var args = Array.prototype.slice.call(arguments);
    this.registered.forEach(function(s) {
      if (s.localConnection) {
        s.send.apply(s, args);
      }
    });
  },

  broadcastOthers: function() {
    var args = Array.prototype.slice.call(arguments),
        server = args.shift();
    this.registered.forEach(function(s) {
      if (s.localConnection && s != server) {
        s.send.apply(s, args);
      }
    });
  }
};

exports.History = History;
exports.ChannelDatabase = ChannelDatabase;
exports.UserDatabase = UserDatabase;
exports.LinkDatabase = LinkDatabase;

