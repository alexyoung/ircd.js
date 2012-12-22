var irc = require('./protocol'),
    ircd = require(__dirname + '/../lib/ircd');

function Commands(server) {
  this.server = server;
}

Commands.prototype = {
  PONG: function(user, hostname) {
    user.lastPing = Date.now();
  },

  PING: function(user, hostname) {
    user.lastPing = Date.now();
    user.send(this.server.host, 'PONG', this.server.config.hostname, this.server.host);
  },

  PASS: function(user, password) {
    var self = this.server;
    ircd.compareHash(password, self.config.serverPassword, function(err, res) {
      if (res) {
        user.passwordAccepted = true;
        user.server = self;
        user.runPostAuthQueue();
      } else {
        user.send(self.host, irc.errors.passwordWrong, user.nick || 'user', ':Password incorrect');
        user.quit();
      }
    });
  },

  AWAY: function(user, message) {
    if (user.isAway && (!message || message.length === 0)) {
      user.isAway = false;
      user.awayMessage = null;
      user.send(this.server.host, irc.reply.unaway, user.nick, ':You are no longer marked as being away');
    } else if (message && message.length > 0) {
      user.isAway = true;
      user.awayMessage = message;
      user.send(this.server.host, irc.reply.nowAway, user.nick, ':You have been marked as being away');
    } else {
      user.send(this.server.host, irc.errors.needMoreParams, user.nick, ':Need more parameters');
    }
  },

  VERSION: function(user, server) {
    // TODO: server
    user.send(this.server.host,
              irc.reply.version,
              user.nick,
              this.server.version + '.' + (this.server.debug ? 'debug' : ''),
              this.server.config.hostname, ':' + this.server.config.name);
  },

  TIME: function(user, server) {
    // TODO: server
    user.send(this.server.host, irc.reply.time, user.nick, this.server.config.hostname, ':' + (new Date()));
  },

  NICK: function(user, nick) {
    var oldMask = user.mask;

    if (!nick || nick.length === 0) {
      return user.send(this.server.host, irc.errors.noNickGiven, ':No nickname given');
    } else if (nick === user.nick) {
      return;
    } else if (nick.length > (this.server.config.maxNickLength || 9) || nick.match(irc.validations.invalidNick)) {
      return user.send(this.server.host, irc.errors.badNick, (user.nick || ''), nick, ':Erroneus nickname');
    } else if (this.server.valueExists(nick, this.server.users.registered, 'nick')) {
      return user.send(this.server.host, irc.errors.nameInUse, '*', nick, ':is already in use');
    }

    nick = nick.trim();
    user.send(user.mask, 'NICK', ':' + nick);

    user.channels.forEach(function(channel) {
      var users = channel.users.splice(channel.users.indexOf(user), 1);
      channel.sendToGroup(users, user.mask + ' NICK : ' + nick);
    });

    user.nick = nick.trim();
    user.register();
  },

  USER: function(user, username, hostname, servername, realname) {
    this.server.users.register(user, username, hostname, servername, realname);
  },

  JOIN: function(user, channelNames, key) {
    var server = this.server;
    if (!channelNames || !channelNames.length) {
      return user.send(this.server.host, irc.errors.needMoreParams, user.nick, ':Need more parameters');
    }

    channelNames.split(',').forEach(function(args) {
      var nameParts = args.split(' '),
          channelName = nameParts[0];

      if (!server.channelTarget(channelName)
          || channelName.match(irc.validations.invalidChannel)) {
        user.send(server.host, irc.errors.noSuchChannel, ':No such channel');
      } else {
        server.channels.join(user, channelName, key);
      }
    });
  },

  // TODO: this.server can accept multiple channels according to the spec
  PART: function(user, channelName, partMessage) {
    var channel = this.server.channels.find(channelName);
    if (channel && user.channels.indexOf(channel) !== -1) {
      partMessage = partMessage ? ' :' + partMessage : '';
      channel.send(user.mask, 'PART', channelName + partMessage);
      channel.part(user);
      this.server.channels.remove(channel);
    }
  },

  KICK: function(user, channels, users, kickMessage) {
    var channelMasks = channels.split(','),
        userNames = users.split(','),
        server = this.server;

    kickMessage = kickMessage ? ':' + kickMessage : ':' + user.nick;

    // ERR_BADCHANMASK

    if (userNames.length !== channelMasks.length) {
      user.send(this.server.host, irc.errors.needMoreParams, user.nick, ':Need more parameters');
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
    var channel = this.server.channels.find(channelName);

    if (!channel) {
      user.send(this.server.host, irc.errors.noSuchNick, user.nick, channelName, ':No such nick/channel');
    } else {
      if (channel.modes.indexOf('t') === -1 || user.isHop(channel)) {
        channel.topic = topic;
        channel.send(user.mask, 'TOPIC', channel.name, ':' + topic);
      } else {
        user.send(this.server.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You must be at least half-op to do that!");
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
      user.send(this.server.host, irc.errors.noRecipient, ':No recipient given');
    } else if (!message || message.length === 0) {
      user.send(this.server.host, irc.errors.noTextToSend, ':No text to send');
    } else if (this.server.channelTarget(target)) {
      var channel = this.server.channels.find(target);
      if (!channel) {
        user.send(this.server.host, irc.errors.noSuchNick, user.nick, target, ':No such nick/channel');
      } else if (channel.isModerated && !user.isVoiced(channel)) {
        user.send(this.server.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
      } else if (user.channels.indexOf(channel) === -1) {
        if (channel.modes.indexOf('n') !== -1) {
          user.send(this.server.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
          return;
        }
      } else {
        this.server.channels.message(user, channel, message);
      }
    } else {
      user.message(target, message);
    }
  },

  INVITE: function(user, nick, channelName) {
    var channel = this.server.channels.find(channelName),
        targetUser = this.server.users.find(nick);

    // TODO: Can this.server accept multiple channel names?
    // TODO: ERR_NOTONCHANNEL
    if (!targetUser) {
      user.send(this.server.host, irc.errors.noSuchNick, user.nick, nick, ':No such nick/channel');
      return;
    } else if (channel) {
      if (channel.isInviteOnly && !user.isOp(channel)) {
        user.send(this.server.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You're not channel operator");
        return;
      } else if (channel.onInviteList(targetUser)) {
        user.send(this.server.host, irc.errors.userOnChannel, user.nick, targetUser.nick, ':User is already on that channel');
        return;
      }
    } else if (!this.server.channelTarget(channelName)) {
      // Invalid channel
      return;
    } else {
      // TODO: Make this.server a register function
      // Create the channel
      channel = this.server.channels.registered[this.server.normalizeName(channelName)] = new Channel(channelName, this.server);
    }

    user.send(this.server.host, irc.reply.inviting, user.nick, targetUser.nick, channelName);
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
    var server = this.server;

    if (this.server.channelTarget(target)) {
      var channel = this.server.channels.find(target);
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
          user.send(this.server.host, irc.reply.endBan, user.nick, channel.name, ':End of Channel Ban List');
        }
      } else {
        user.send(this.server.host, irc.reply.channelModes, user.nick, channel.name, channel.modes);
      }
    } else {
      // TODO: Server user modes
      var targetUser = this.server.users.find(target);
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
    var server = this.server,
        channels = {};
    user.send(this.server.host, irc.reply.listStart, user.nick, 'Channel', ':Users  Name');
    if (targets) {
      targets = targets.split(',');
      targets.forEach(function(target) {
        var channel = server.channels.find(target);
        if (channel) {
          channels[channel.name] = channel;
        }
      });
    } else {
      channels = this.server.channels.registered;
    }

    for (var i in channels) {
      var channel = channels[i];
      // if channel is secret or private, ignore
      if (channel.isPublic || channel.isMember(user)) {
        user.send(this.server.host, irc.reply.list, user.nick, channel.name, channel.memberCount, ':[' + channel.modes + '] ' + channel.topic);
      }
    }

    user.send(this.server.host, irc.reply.listEnd, user.nick, ':End of /LIST');
  },

  // TODO: LIST
  NAMES: function(user, targets) {
    var server = this.server;
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
    user.send(this.server.host, irc.reply.endNames, user.nick, '*', ':End of /NAMES list.'); 
  },

  WHO: function(user, target) {
    var server = this.server;

    if (this.server.channelTarget(target)) {
      // TODO: Channel wildcards
      var channel = this.server.channels.find(target);

      if (!channel) {
        user.send(this.server.host, irc.errors.noSuchChannel, user.nick, ':No such channel');
      } else {
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
        user.send(this.server.host, irc.reply.endWho, user.nick, channel.name, ':End of /WHO list.');
      }
    } else {
      var matcher = this.server.normalizeName(target).replace(/\?/g, '.');
      this.server.users.registered.forEach(function(targetUser) {
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
      user.send(this.server.host, irc.reply.endWho, user.nick, target, ':End of /WHO list.');
    }
  },

  WHOIS: function(user, nickmask) {
    // TODO: nick masks
    var target = this.server.users.find(nickmask);
    if (target) {
      var channels = target.channels.map(function(channel) {
        if (channel.isSecret && !channel.isMember(user)) return;

        if (target.isOp(channel)) {
          return '@' + channel.name;
        } else {
          return channel.name;
        }
      });

      user.send(this.server.host, irc.reply.whoIsUser, user.nick, target.nick,
                target.username, target.hostname, '*', ':' + target.realname);
      user.send(this.server.host, irc.reply.whoIsChannels, user.nick, target.nick, ':' + channels);
      user.send(this.server.host, irc.reply.whoIsServer, user.nick, target.nick, this.server.config.hostname, ':' + this.server.config.serverDescription);
      if (target.isAway) {
        user.send(this.server.host, irc.reply.away, user.nick, target.nick, ':' + target.awayMessage);
      }
      user.send(this.server.host, irc.reply.whoIsIdle, user.nick, target.nick, target.idle, user.created, ':seconds idle, sign on time');
      user.send(this.server.host, irc.reply.endOfWhoIs, user.nick, target.nick, ':End of /WHOIS list.');
    } else if (!nickmask || nickmask.length === 0) {
      user.send(this.server.host, irc.errors.noNickGiven, user.nick, ':No nick given');
    } else {
      user.send(this.server.host, irc.errors.noSuchNick, user.nick, nickmask, ':No such nick/channel');
    }
  },

  WHOWAS: function(user, nicknames, count, serverName) {
    // TODO: Server
    var server = this.server,
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
      user.send(this.server.host, irc.reply.endWhoWas, user.nick, nicknames, ':End of WHOWAS');
    } else {
      user.send(this.server.host, irc.errors.wasNoSuchNick, user.nick, nicknames, ':There was no such nickname');
    }
  },

  WALLOPS: function(user, text) {
    if (!text || text.length === 0) {
      user.send(this.server.host, irc.errors.needMoreParams, user.nick, ':Need more parameters');
      return;
    }

    this.server.users.registered.forEach(function(user) {
      if (user.modes.indexOf('w') !== -1) {
        user.send(this.server.host, 'WALLOPS', ':OPERWALL - ' + text);
      }
    });
  },

  // TODO: Local ops
  OPER: function(user, name, password) {
    if (!name || !password) {
      user.send(this.server.host, irc.errors.wasNoSuchNick, user.nick, ':OPER requires a nick and password');
    } else {
      var userConfig,
          self = this.server,
          targetUser = self.config.opers[name];

      if (targetUser === undefined) {
        user.send(self.host, irc.errors.noSuchNick, user.nick, ':No such nick.');
      } else {
        ircd.compareHash(password, targetUser.password, function(err, res) {
          if (res) {
            user.send(self.host, irc.reply.youAreOper, user.nick, ':You are now an IRC operator');
            user.oper();
          } else {
            user.send(self.host, irc.errors.passwordWrong, user.nick || 'user', ':Password incorrect');
          }
        });
      }
    }
  },

  QUIT: function(user, message) {
    user.quit(message);
    this.server.history.add(user);
    delete user;
  },

  MOTD: function(user) {
    this.server.motd(user);
  }  
};

module.exports = Commands;
