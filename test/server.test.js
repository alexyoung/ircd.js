var assert = require('assert')
  , helpers = require('./helpers.js')
  ;

module.exports = {
  'Server': {
    beforeEach: function(done) {
      this.server = new helpers.MockServer(done, true, 6662);
    },

    afterEach: function(done) {
      this.server.close(done);
    },

    'test connection passwords': function(done) {
      var createClient = this.server.createClient.bind(this.server);
      createClient({ nick: 'testbot1', channel: '#test', password: 'test' }, function(testbot1) {
        testbot1.on('raw', function(data) {
          if (data.command === 'rpl_channelmodeis') {
            // Ensure users can't join with the same nicks
            createClient({ nick: 'testbot1', channel: '#test', password: 'test' }, function(testbot2) {
              testbot2.on('raw', function(data) {
                if (data.command === 'rpl_channelmodeis') {
                  assert.notEqual(testbot1.nick, testbot2.nick, "The same nick shouldn't be used more than once");
                  testbot1.disconnect();
                  testbot2.disconnect();
                  done();
                }
              });
            });
          }
        });
      });
    }
  }
};
