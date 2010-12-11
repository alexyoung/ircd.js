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

  this.hopCount = 0;
  this.info = null;
  this.isConnected = false;

  this.authenticated = false;
  this.gotServerInfo = false;

  this.__defineGetter__('id', function() {
    return this.name;
  });
}

RemoteServer.prototype = {
  send: function() {
    var message = arguments.length === 1 ?
        arguments[0]
      : Array.prototype.slice.call(arguments, 0, -1).join(' ') + ' :' + arguments[arguments.length - 1];

    this.peer.log('RemoteServer TX: [' + this.host + ':' + this.port + '] ' + message);

    try {
      this.stream.write(message + '\r\n');
    } catch (exception) {
      this.peer.log('RemoteServer ERROR: ' + exception);
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
    this.peer.log('RemoteServer ESTABLISHING LINK: ' + this.host + ':' + this.port);

    this.stream = net.createConnection(this.port, this.address);
    carrier.carry(this.stream).on('line', function(data) { server.read(data); })
    this.stream.addListener('connect', function() { server.connected(); });
    this.stream.addListener('end', function() { server.disconnected(); });
  },

  read: function(line) {
    line = line.slice(0, 512);
    this.peer.log('RemoteServer RX: [' + this.host + ':' + this.port + '] ' + line);

    var message = this.peer.parse(line);
    if (this.serverCommands[message.command]) {
      return this.serverCommands[message.command].apply(this, message.args);
    }
  },

  serverCommands: {
    SERVER: function(serverName, hopCount, token, info) {
      // ERR_ALREADYREGISTRED
      if (this.name === serverName) {
        this.gotServerInfo = true;
        this.peer.replyToLinkInitialization(this);
      } else {
        this.send('ERROR', 'Incorrect server name');
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
