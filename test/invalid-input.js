var assert = require('assert'),
  path = require('path'),
  net = require('net'),
  Server = require(path.join(__dirname, '..', 'lib', 'server')).Server,
  server = new Server(),
  testCase = require('nodeunit').testCase;

server.config = {
  "network": "ircn",
  "hostname": "localhost",
  "serverDescription": "A Node IRC daemon",
  "serverName": "server",
  "port": 6667,
  "linkPort": 7777,
  "whoWasLimit": 10000,
  "token": 1,
  "opers": { },
  "links": { }
};

module.exports = testCase({
  setUp: function(ready) {
    if (!server.tcpServer) {
        server.start(ready);
    } else {
        ready();
    }
  },
  
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
    alice.write('NICK alice\n\x00\x07abc\r\uAAAA', test.done);
  }
});
