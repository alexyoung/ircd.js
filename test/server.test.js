var assert = require('assert'),
    helpers = require('./helpers.js'),
    createClient = helpers.createClient,
    testCase = require('nodeunit').testCase;

module.exports = {
  setUp: function(done) {
    helpers.createServer(done, true);
  },

  tearDown: function(done) {
    helpers.close(done);
  },

  'test connection passwords': function(test) {
    createClient({ nick: 'testbot1', channel: '#test', password: 'test' }, function(testbot1) {
      testbot1.on('raw', function(data) {
        if (data.command === 'rpl_channelmodeis') {
          testbot1.disconnect();
          test.done();
        }
      });
    });
  }
};
