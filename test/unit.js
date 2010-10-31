var port = 6667,
    assert = require('assert'),
    path = require('path'),
    ircd = require(path.join(__dirname, '..', 'server')),
    server = ircd.ircServer,
    tcp = ircd.tcpServer,
    irc = require('irc');

server.showLog = true;

function runTests() {
  function end() {
    tcp.close();
    console.log('Tests passed');
    process.exit();
  }

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

  console.log('Starting tests');

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
}

runTests();

