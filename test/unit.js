var port = 6667,
    assert = require('assert'),
    path = require('path'),
    ircd = require(path.join(__dirname, '..', 'server')),
    server = ircd.ircServer,
    tcp = ircd.tcpServer,
    irc = require('irc');

server.showLog = false;

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

  console.log('Starting tests');

  client.addListener('join', function() {
    assert.equal(server.users.registered[0].nick, 'testbot');
    end();
  });
}

runTests();

