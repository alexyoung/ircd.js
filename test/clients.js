var port = 6667,
    assert = require('assert'),
    path = require('path'),
    ircd = require(path.join(__dirname, '..', 'server')),
    server = ircd.ircServer,
    irc = require('irc'),
    events = require('events'),
    testEmitter = new events.EventEmitter();

function run(tests) {
  var queue = [],
      passed = 0,
      failed = 0,
      errors = 0;

  testEmitter.on('test finished', function() {
    runNext();
  });

  function runLater(testName, test) {
    queue.push([testName, test]);
  }

  function runNext() {
    if (queue.length > 0) {
      var ended = false,
          test = queue.shift();
      console.log('\n* Running: ' + test[0]);

      try {
        test[1](function() {
          if (ended) return;
          ended = true;
          passed += 1;
          testEmitter.emit('test finished');
        });
      } catch (e) {
        if (e.name === 'AssertionError') {
          failed += 1;
        } else {
          errors += 1;
        }
        console.log(e)
      }
    } else {
      delay(function() {
        console.log('\nPassed: ' + passed);
        console.log('Failed: ' + failed);
        console.log('Errors: ' + errors);
        tests.teardown();
        process.exit();
      });
    }
  }

  for (testName in tests) {
    if (testName.match(/^test/)) {
      runLater(testName, tests[testName]);
    }
  }

  runNext();
}

function delay(fn) {
  setTimeout(fn, 100);
}

run({
  'test nicks': function(end) {
    var client = new irc.Client('localhost', 'testbot', {
      channels: ['#test'],
      port: port,
      debug: false
    });

    var client2 = new irc.Client('localhost', 'testbot2', {
      channels: ['#tEst'],
      port: port,
      debug: false
    });

    // Because of IRC's scandinavian origin, the characters {}| are
    // considered to be the lower case equivalents of the characters []\,
    // respectively. This is a critical issue when determining the
    // equivalence of two nicknames.
    assert.equal('name[]\\', server.normalizeName('name{}|'));
    assert.equal('name[]\\', server.normalizeName('name[]\\'));

    client2.on('raw', function(data) {
      if (data.rawCommand === '433') {
        assert.equal('testbot', data.args[1], 'Nick changes should not be case sensitive');
        end();
      }
    });

    client.addListener('join', function() {
      assert.equal(server.users.registered[0].nick, 'testbot');

      client2.addListener('join', function() {
        assert.equal(server.channels.find('#test'),
                     server.channels.find('#tEst'),
                     'Channel names are not case sensitive');

        client2.send('NICK', 'testbot');
      });
    });
  },

  'test secret channels in WHOIS': function(end) {
    var setMode = true, client, client2;

    client = new irc.Client('localhost', 'n1', {
      channels: ['#secret'],
      port: port,
      debug: false
    });

    client.addListener('join', function() {
      client2 = new irc.Client('localhost', 'n2', {
        channels: ['#test'],
        port: port,
        debug: false
      });

      client.send('MODE', '#secret', '+s');

      client.on('raw', function(data) {
        if (data.rawCommand === 'MODE') {
          setMode = true;
        }
      });

      client2.on('join', function() {
        client2.send('WHOIS', 'n1');
      });

      client2.on('raw', function(data) {
        if (data.rawCommand === '319') {
          // The third parameter would have been the channel
          assert.equal(2, data.args.length, "Shouldn't be able to see secret channels in WHOIS");
          end();
        }
      });
    });
  },


  'teardown': function() {
    server.close();
  }
});

