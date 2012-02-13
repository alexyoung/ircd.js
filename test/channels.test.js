var assert = require('assert'),
    helpers = require('./helpers'),
    createClient = helpers.createClient,
    testCase = require('nodeunit').testCase;

module.exports = {
  setUp: function(done) {
    helpers.createServer(done);
  },

  tearDown: function(done) {
    helpers.close(done);
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
  },

  'remove channels when the last person leaves (#25)': function(test) {
    // Create two clients
    createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
      function done() {
        testbot1.disconnect();
        test.done();
      }

      var seenList = false;

      testbot1.on('raw', function(data) {
        // Double equal, because this is returned as a string but could easily
        // be returned as an integer if the IRC client library changes
        if (data.rawCommand == 322) {
          if (seenList) {
            assert.fail('Channels should be deleted');
          } else {
            assert.equal(data.args[1], '#test', 'The #test channel should be returned by LIST');

            // Now part the channel
            testbot1.part('#test');
          }
        } else if (data.rawCommand == 323 && !seenList) {
          seenList = true;
        } else if (data.rawCommand == 323 && seenList) {
          done();
        } else if (data.command === 'PART') {
          testbot1.send('LIST');
        }
      });

      // Send a list command
      testbot1.send('LIST');
    });
  }
};
