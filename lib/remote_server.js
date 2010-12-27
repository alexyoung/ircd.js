var net = require('net'),
    carrier = require('carrier');

// TODO: Use generic logging

function RemoteServer(peer, serverName, options) {
  this.peer = peer;
  this.name = serverName;
  this.host = options.host;
  this.password = options.password;
  this.port = options.port;
  this.token = options.token;

  this.hopCount = options.hopCount || 0;
  this.info = options.info || '';
  this.isConnected = false;
  this.localConnection = false;
  this.authenticated = false;
  this.gotServerInfo = false;
}

RemoteServer.prototype = {
  get id() {
    return this.name;
  },

  send: function() {
    var message = arguments.length === 1 ?
        arguments[0]
      : Array.prototype.slice.call(arguments, 0, -1).join(' ') + ' :' + arguments[arguments.length - 1];

    try {
      this.stream.write(message + '\r\n');
    } catch (exception) {
      console.log('RemoteServer [' + this.name + '] ERROR: ' + exception);
      console.log('\t' + message);
    }
  },

  attemptConnection: function() {
    // TODO: check if already connected, etc
    if (!this.isConnected)
      this.connect();
  },

  connect: function() {
    var server = this;
    this.isConnected = true;
    this.localConnection = true;
    this.stream = net.createConnection(this.port, this.address);
    carrier.carry(this.stream).on('line', function(data) { server.read(data); })
    this.stream.addListener('connect', function() { server.connected(); });
    this.stream.addListener('end', function() { server.disconnected(); this.isConnected = false; });
  },

  read: function(line) {
    line = line.slice(0, 512);

    var message = this.peer.parse(line);
    if (this.serverCommands[message.command]) {
      return this.serverCommands[message.command].apply(this, message.args);
    }
  },

  serverCommands: {
    SERVER: function() {
      // TODO: ERR_ALREADYREGISTRED
      var origin = this.peer.name,
          localName = this.peer.name,
          serverName,
          hopCount,
          token,
          info;

      if (arguments.length === 4) {
        serverName = arguments[0];
        hopCount = arguments[1];
        token = arguments[2];
        info = arguments[3];

        if (serverName === this.name) {
          this.gotServerInfo = true;
          this.peer.replyToLinkInitialization(this);
        }
      } else {
        origin = arguments[0];
        serverName = arguments[1];
        hopCount = arguments[2];
        token = arguments[3];
        info = arguments[4];

        this.peer.servers.registerRemote({ name: origin }, serverName, { token: token, hopCount: hopCount, host: origin });

        // Tell other servers about this connection
        this.peer.servers.broadcastOthers(this, ':' + origin, 'SERVER', serverName, hopCount, token, info);
      }
    },

    PASS: function(password, version, flags, options) {
      // TODO: Spec says stuff about only doing this once, etc.
      if (password === this.password) {
        this.authenticated = true;
        this.peer.replyToLinkInitialization(this);
      } else {
        this.send('ERROR', 'Incorrect link password');
      }
    },

    NJOIN: function(channelName, users) {
      console.log('NJOIN! (in remote server) ', channelName, users);
    }
  },

  connected: function() {
  },

  disconnected: function() {
    this.isConnected = false;
    this.peer.log('RemoteServer DISCONNECTED: ' + this.host + ':' + this.port);
  }
};

exports.RemoteServer = RemoteServer;
