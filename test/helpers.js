var path = require('path'),
    Server = require(path.join(__dirname, '..', 'lib', 'server')).Server,
    irc = require('irc'),
    server;

function createServer(test) {
  server = new Server();
  server.showLog = false;
  server.config = {
    'network': 'ircn',
    'hostname': 'localhost',
    'serverDescription': 'A Node IRC daemon',
    'serverName': 'server',
    'port': 6667,
    'linkPort': 7777,
    'whoWasLimit': 10000,
    'token': 1,
    'opers': {},
    'links': {}
  };

  server.start(test);
}

function createClient(options, fn) {
  var ranCallback = false,
      client = new irc.Client('localhost', options.nick, {
        channels: [options.channel],
        port: 6667,
        debug: false
      });

  client.addListener('join', function() {
    if (!ranCallback) {
      fn(client);
      ranCallback = true;
    }
  });
}

function createClients(nicks, channel, fn) {
  var connected = [];

  nicks.forEach(function(nick) {
    createClient({ nick: nick, channel: channel }, function(bot) {
      connected.push(bot);
      if (connected.length == nicks.length) {
        fn(connected);
      }
    });
  });
}

module.exports = {
  createServer: createServer,
  createClient: createClient,
  createClients: createClients,
  close: function(fn) {
    server.close(fn);
  },
  server: function() {
    return server;
  }
};
