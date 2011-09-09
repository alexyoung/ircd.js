var assert = require('assert'),
    path = require('path'),
    net = require('net'),
    Server = require(path.join(__dirname, '..', 'lib', 'server')).Server,
    server,
    testCase = require('nodeunit').testCase;

exports.createServer = function(test) {
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

  server.start();
  test.done();
};

exports.invalidInputTests = {
  'destroy a socket': function(test) {
    var bob = net.createConnection(server.config.port, server.config.hostname);
    bob.write('garbage');
    process.nextTick(function() {
      bob.destroy();
      test.done();
    });
  },
  
  'send garbage': function(test) {
    var alice = net.createConnection(server.config.port, server.config.hostname);
    alice.write('NICK alice\n\x00\x07abc\r\uAAAA', 'ascii', function() {
      alice.end();
      test.done();
    });
  }
};

exports.closeServer = function(test) {
  server.close(test.done);
};
