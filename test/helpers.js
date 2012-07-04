var path = require('path')
  , Server = require(path.join(__dirname, '..', 'lib', 'server')).Server
  , irc = require('irc')
  , winston = require('winston')
  ;

winston.remove(winston.transports.Console);

function MockServer(done, usepass, port) {
  this.server = new Server();
  this.server.showLog = false;
  this.server.config = {
    'network': 'ircn',
    'hostname': 'localhost',
    'serverDescription': 'A Node IRC daemon',
    'serverName': 'server',
    'port': port,
    'linkPort': 7777,
    'whoWasLimit': 10000,
    'token': 1,
    'opers': {},
    'links': {}
  };

  if (usepass) {
    this.server.config.serverPassword = '$2a$10$T1UJYlinVUGHqfInKSZQz./CHrYIVVqbDO3N1fRNEUvFvSEcshNdC';
  }

  this.server.start(done);
}

MockServer.prototype = {
  close: function(done) {
    this.server.close(done);
  },

  createClient: function(options, fn) {
    options.port = this.server.config.port;

    var ranCallback = false
      , client = new irc.Client('localhost', options.nick, {
          channels: [options.channel]
        , port: options.port
        , debug: false
        , password: options.password
      });

    client.addListener('join', function() {
      if (!ranCallback) {
        fn(client);
        ranCallback = true;
      }
    });
  },

  createClients: function(nicks, channel, fn) {
    var connected = []
      , createClient = this.createClient.bind(this);

    nicks.forEach(function(nick) {
      createClient({ nick: nick, channel: channel }, function(bot) {
        connected.push(bot);
        if (connected.length == nicks.length) {
          fn(connected);
        }
      });
    });
  }
};

module.exports = {
  MockServer: MockServer
, createServer: function(usepass, port, fn) {
    var server = new MockServer(function() { fn(server); }, usepass, port);
  }
};
