var assert = require('assert')
  , net = require('net')
  , helpers = require('./helpers')
  ;

module.exports = {
  'Sockets': {
    beforeEach: function(done) {
      this.server = new helpers.MockServer(done, false, 6663);
    },

    afterEach: function(done) {
      this.server.close(done);
    },

    'test destroy a socket': function(done) {
      var server = this.server.server
        , bob = net.createConnection(server.config.port, server.config.hostname);

      bob.write('garbage');
      process.nextTick(function() {
        bob.destroy();
        done();
      });
    },
    
    'test send garbage': function(done) {
      var server = this.server.server
        , alice = net.createConnection(server.config.port, server.config.hostname);

      alice.write('NICK alice\n\x00\x07abc\r\uAAAA', 'ascii', function() {
        alice.end();
        done();
      });
    }
  }
};
