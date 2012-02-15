var assert = require('assert'),
    net = require('net'),
    helpers = require('./helpers'),
    testCase = require('nodeunit').testCase;

module.exports = {
  setUp: function(done) {
    helpers.createServer(done);
  },

  tearDown: function(done) {
    helpers.close(done);
  },

  'test destroy a socket': function(test) {
    var bob = net.createConnection(helpers.server().config.port, helpers.server().config.hostname);
    bob.write('garbage');
    process.nextTick(function() {
      bob.destroy();
      test.done();
    });
  },
  
  'test send garbage': function(test) {
    var alice = net.createConnection(helpers.server().config.port, helpers.server().config.hostname);
    alice.write('NICK alice\n\x00\x07abc\r\uAAAA', 'ascii', function() {
      alice.end();
      test.done();
    });
  }
};

