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
        var user = server.users.registered.filter(function(user) { return user.nick == testbot2.nick; })[0];

        // Simulate a socket issue by causing user.send to raise an exception
        user.stream = 'bad';
        testbot2.send('WHO', '#test');
        
        setTimeout(function() {
          // There should now be one user instead of two in the channel
          assert.equal(1, server.channels.registered['#test'].users.length);
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
          assert.equal(server.channels.registered['#test'].users.length, 1);
          testbot1.disconnect();
          test.done();
        }, 10);
      });
    });
  }
};
