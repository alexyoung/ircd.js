var assert = require('assert'),
    path = require('path'),
    net = require('net'),
    irc = require('irc'),
    Server = require(path.join(__dirname, '..', 'lib', 'server')).Server,
    server,
    testCase = require('nodeunit').testCase;

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

module.exports = {
  setUp: function(done) {
    createServer(done);
  },

  tearDown: function(done) {
    server.close(done);
  },

  'test bad join (#22)': function(test) {
    // Create two clients
    createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
      createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {

        testbot1.addListener('error', function(message) {
          if (message.command === 'err_needmoreparams') {
            testbot1.disconnect();
            testbot2.disconnect();
            test.done();
          }
        });

        testbot1.on('raw', function(data) {
          if (data.command === 'JOIN') {
            testbot1.send('join');
          }
        });
      });
    });
  },

  'test messaging a non-existent channel (#26)': function(test) {
    // Create two clients
    createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
      createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
        testbot1.addListener('error', function(message) {
          if (message.command === 'err_nosuchnick') {
            testbot1.disconnect();
            testbot2.disconnect();
            test.done();
          }
        });
        
        testbot1.say('#error', 'Hello');
      });
    });
  }

};
