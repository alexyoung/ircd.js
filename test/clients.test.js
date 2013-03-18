var assert = require('assert')
  , helpers = require('./helpers.js')
  , irc = require('irc')
  , port = 6661
  ;

module.exports = {
  'Clients': {
    beforeEach: function(done) {
      this.server = new helpers.MockServer(done, false, port);
    },

    afterEach: function(done) {
      this.server.close(done);
    },

    'test valid WHOIS': function(done) {
      var createClient = this.server.createClient.bind(this.server);

      createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
        createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
          testbot1.on('raw', function(data) {
            if (data.command === 'JOIN') {
              testbot1.send('WHOIS', 'testbot2');
            } else if (data.command === 'rpl_whoisuser') {
              assert.equal('testbot2', data.args[1]);
              testbot1.disconnect();
              testbot2.disconnect();
              done();
            }
          });
        });
      });
    },

    'valid WHO': function(done) {
      var createClient = this.server.createClient.bind(this.server);

      createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
        createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
          testbot1.on('raw', function(data) {
            if (data.command === 'rpl_endofwho') {
              assert.equal('#test', data.args[1]);
              testbot1.disconnect();
              testbot2.disconnect();
              done();
            }
          });
          testbot1.send('WHO', '#test');
        });
      });
    },

    'invalid WHO (bug #9)': function(done) {
      var createClient = this.server.createClient.bind(this.server);

      createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
        createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
          testbot1.addListener('error', function(message) {
            if (message.command === 'err_nosuchchannel') {
              testbot1.disconnect();
              testbot2.disconnect();
              done();
            }
          });

          testbot1.send('WHO', '#argh');
        });
      });
    },

    'socket error handling (bug #10)': function(done) {
      var createClient = this.server.createClient.bind(this.server)
        , server = this.server.server;

      createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
        createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
          var user = server.users.registered.filter(function(user) { return user.nick == testbot2.nick; })[0];

          // Simulate a socket issue by causing user.send to raise an exception
          user.stream = 'bad';
          testbot2.send('WHO', '#test');

          setTimeout(function() {
            // There should now be one user instead of two in the channel
            assert.equal(1, server.channels.registered['#test'].users.length);
            testbot1.disconnect();
            testbot2.disconnect();
            done();
          }, 10);
        });
      });
    },

    "users shouldn't be able to join channel twice (bug #12)": function(done) {
      var createClient = this.server.createClient.bind(this.server)
        , server = this.server.server;

      createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
        testbot1.join('#test', function() {
          setTimeout(function() {
            assert.equal(server.channels.registered['#test'].users.length, 1);
            testbot1.disconnect();
            done();
          }, 10);
        });
      });
    },

    'invalid ban mask (bug #19)': function(done) {
      var createClient = this.server.createClient.bind(this.server);

      createClient({ nick: 'huey', channel: '#aff' }, function(huey) {
        huey.send('MODE', '#aff', '+b');
        huey.on('error', function(data) {
          if (data.command === 'err_needmoreparams') {
            createClient({ nick: 'dewey', channel: '#aff' }, function(dewey) {
              huey.disconnect();
              dewey.disconnect();
              done();
            });
          }
        });
      });
    },

    'invalid away status (bug #18)': function(done) {
      var createClient = this.server.createClient.bind(this.server);

      createClient({ nick: 'huey', channel: '#aff' }, function(huey) {
        var dewey;

        huey.send('AWAY');
        huey.on('message', function(from, to, message) {
          assert.equal('dewey', from);
          assert.equal('huey', to);
          assert.equal('Hello', message);
          huey.disconnect();
          dewey.disconnect();
          done();
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

    'simultaneous user simulation': function(done) {
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

      this.server.createClients(nicks, '#test', function(bots) {
        function teardown() {
          bots.forEach(function(bot) {
            bot.disconnect();
          });
          done();
        }

        var i, tested = 0, max = bots.length - 1;
        for (i = 0; i < max; i++) {
          assertReceive([bots[i], bots[i + 1]], 'Message ' + Math.random(), function() {
            tested++;
            if (tested === max) {
              teardown();
            }
          });
        }
      });
    },

    'send messages with colons (#49)': function(done) {
      var createClient = this.server.createClient.bind(this.server)
        , server = this.server.server
        , message = 'this is my message : hello tom'
        ;

      createClient({ nick: 'testbot1', channel: '#test' }, function(testbot1) {
        createClient({ nick: 'testbot2', channel: '#test' }, function(testbot2) {
          var user = server.users.registered.filter(function(user) { return user.nick == testbot2.nick; })[0];

          testbot1.on('message', function(from, to, m) {
            assert.equal(message, m);

            testbot1.disconnect();
            testbot2.disconnect();
            done();
          });

          testbot2.say('#test', message);
        });
      });
    },

    'invalid nicks (#27)': function(done) {
      var nick = 'a|ex'
        , self = this
        , client = new irc.Client('localhost', nick, {
            channels: ['#test']
          , port: port
          , debug: false
        });

      client.addListener('error', function(message) {
        var connectedUsers = self.server.server.users.registered;
        if (message.command === 'err_erroneusnickname') {
          assert.equal(1, connectedUsers.length);
          assert.equal(null, connectedUsers[0].nick);
          client.disconnect();
          done();
        }
      });
    }
  }
};
