var assert = require('assert'),
    helpers = require('./helpers.js'),
    createClient = helpers.createClient,
    testCase = require('nodeunit').testCase;

module.exports = {
  setUp: function(done) {
    helpers.createServer(done);
  },

  tearDown: function(done) {
    helpers.close(done);
  },

  'test valid WHOIS': function(test) {
    createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
      createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
        testbot1.on('raw', function(data) {
          if (data.command === 'JOIN') {
            testbot1.send('WHOIS', 'testbot2');
          } else if (data.command === 'rpl_whoisuser') {
            assert.equal('testbot2', data.args[1]);
            testbot1.disconnect();
            testbot2.disconnect();
            test.done();
          }
        });
      });
    });
  },

  'valid WHO': function(test) {
    createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
      createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
        testbot1.on('raw', function(data) {
          if (data.command === 'rpl_endofwho') {
            assert.equal('#test', data.args[1]);
            testbot1.disconnect();
            testbot2.disconnect();
            test.done();
          }
        });
        testbot1.send('WHO', '#test');
      });
    });
  },

  'invalid WHO (bug #9)': function(test) {
    createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
      createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
        testbot1.addListener('error', function(message) {
          if (message.command === 'err_nosuchchannel') {
            testbot1.disconnect();
            testbot2.disconnect();
            test.done();
          }
        });

        testbot1.send('WHO', '#argh');
      });
    });
  },

  'socket error handling (bug #10)': function(test) {
    createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
      createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
        var user = helpers.server().users.registered.filter(function(user) { return user.nick == testbot2.nick; })[0];

        // Simulate a socket issue by causing user.send to raise an exception
        user.stream = 'bad';
        testbot2.send('WHO', '#test');
        
        setTimeout(function() {
          // There should now be one user instead of two in the channel
          assert.equal(1, helpers.server().channels.registered['#test'].users.length);
          testbot1.disconnect();
          testbot2.disconnect();
          test.done();
        }, 10);
      });
    });
  },
  
  "users shouldn't be able to join channel twice (bug #12)": function(test) {
    createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
      testbot1.join('#test', function() {
        setTimeout(function() {
          assert.equal(helpers.server().channels.registered['#test'].users.length, 1);
          testbot1.disconnect();
          test.done();
        }, 10);
      });
    });
  },

  'invalid ban mask (bug #19)': function(test) {
    createClient({ nick: 'huey', channel: '#aff' }, function(huey) {
      huey.send('MODE', '#aff', '+b');
      huey.on('error', function(data) {
        if (data.command === 'err_needmoreparams') {
          createClient({ nick: 'dewey', channel: '#aff' }, function(dewey) {
            huey.disconnect();
            dewey.disconnect();
            test.done();
          });
        }
      });
    });
  },

  'invalid away status (bug #18)': function(test) {
    createClient({ nick: 'huey', channel: '#aff' }, function(huey) {
      var dewey;

      huey.send('AWAY');
      huey.on('message', function(from, to, message) {
        assert.equal('dewey', from);
        assert.equal('huey', to);
        assert.equal('Hello', message);
        huey.disconnect();
        dewey.disconnect();
        test.done();
      });

      huey.on('error', function(data) {
        if (data.command === 'err_needmoreparams') {
          createClient({ nick: 'dewey', channel: '#aff' }, function(client) {
            dewey = client;
            dewey.say('huey', 'Hello');
          });
        }
      });
    });
  },

  'simultaneous user simulation': function(test) {
    var nicks = [], i;
    for (i = 1; i <= 10; i++) {
      nicks.push('user_' + i);
    }

    function assertReceive(bots, assertion, fn) {
      bots[0].say(bots[1].nick, assertion);

      var callback = function(from, to, message) {
        assert.equal(assertion, message);
        bots[1].removeListener('message', callback);
        fn();
      };

      bots[1].addListener('message', callback);
    }

    helpers.createClients(nicks, '#test', function(bots) {
      function done() {
        bots.forEach(function(bot) {
          bot.disconnect();
        });
        test.done();
      }

      var tested = 0, max = bots.length - 1;
      for (var i = 0; i < max; i++) {
        assertReceive([bots[i], bots[i + 1]], 'Message ' + Math.random(), function() {
          tested++;
          if (tested === max) {
            done();
          }
        });
      }
    });
  }
};
