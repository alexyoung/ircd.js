var assert = require('assert'),
    irc = require('irc'),
    path = require('path'),
    Server = require(path.join(__dirname, '..', 'lib', 'server')).Server,
    events = require('events'),
    testEmitter = new events.EventEmitter(),
    server1 = new Server(),
    server2 = new Server(),
    server3 = new Server(),
    server4 = new Server();

server1.config = {
  "network":  "ircn",
  "hostname": "localhost",
  "serverDescription": "A Node IRC daemon",
  "serverName": "server1",
  "port": 6667,
  "linkPort": 7777,
  "whoWasLimit": 10000,
  "token": 1,
  "opers": {
    "alex": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" },
    "bob": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" },
    "alice": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" }
  },
  "links": {
    "server2": { "host": "127.0.0.1",
                 "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                 "port": 7778,
                 "token": 2 }
  }
};

server2.config = {
  "network":  "ircn",
  "hostname": "localhost",
  "serverDescription": "Another Node IRC daemon",
  "serverName": "server2",
  "whoWasLimit": 10000,
  "port": 8000,
  "linkPort": 7778,
  "token": 2,
  "opers": {
    "alex": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" },
    "bob": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" },
    "alice": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" }
  },
  "links": {
    "server1": { "host": "127.0.0.1",
                 "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                 "port": 7777,
                 "token": 1 },
    "server3": { "host": "127.0.0.1",
                 "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                 "port": 7779,
                 "token": 3 }
  }
};

server3.config = {
  "network":  "ircn",
  "hostname": "localhost",
  "serverDescription": "Yet another Node IRC daemon",
  "serverName": "server3",
  "whoWasLimit": 10000,
  "port": 8001,
  "linkPort": 7779,
  "token": 3,
  "opers": {
    "alex": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" },
    "bob": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" },
    "alice": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" }
  },
  "links": {
    "server2": { "host": "127.0.0.1",
                 "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                 "port": 7778,
                 "token": 2 },
    "server4": { "host": "127.0.0.1",
                 "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                 "port": 7770,
                 "token": 4 }
  }
};

server4.config = {
  "network":  "ircn",
  "hostname": "localhost",
  "serverDescription": "Yet yet another Node IRC daemon",
  "serverName": "server4",
  "whoWasLimit": 10000,
  "port": 8002,
  "linkPort": 7770,
  "token": 4,
  "opers": {
    "alex": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" },
    "bob": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" },
    "alice": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" }
  },
  "links": {
    "server3": { "host": "127.0.0.1",
                 "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                 "port": 7779,
                 "token": 3 }
  }
};

server1.start();
server2.start();
server3.start();
server4.start();

// TODO: Make a client join, oper, then link the two servers
//       and fix the other tests

var client,
    client2,
    client3;

client = new irc.Client('localhost', 'alex', {
  channels: ['#test'],
  port: 6667,
  debug: false
});

client2 = new irc.Client('localhost', 'bob', {
  channels: ['#test'],
  port: 8000,
  debug: false
});

client3 = new irc.Client('localhost', 'alice', {
  channels: ['#test'],
  port: 8001,
  debug: false
});

// Alex

client.on('join', function() {
  client.send('OPER', 'alex', 'password');
});

client.sentConnect = false;
client.on('raw', function(data) {
  if (data.rawCommand == 381 && !client.sentConnect) {
    client.sentConnect = true;
    client.send('CONNECT', 'server2', 'password');

    // Now test the link
    setTimeout(function() {
      client.say('#test', 'Hello');
    }, 250);
  }
});

// Bob
client2.sentConnect = false;
client2.on('join', function() {
  client2.send('OPER', 'bob', 'password');
});

client2.on('raw', function(data) {
  if (data.rawCommand == 381 && !client2.sentConnect) {
    client2.sentConnect = true;
    client2.send('CONNECT', 'server3', 'password');

    // Now test the link
    setTimeout(function() {
      client2.say('#test', 'Welcome');
    }, 250);
  }
});

// Alice
client3.sentConnect = false;
client3.on('join', function() {
  client3.send('OPER', 'alice', 'password');
});

client3.on('raw', function(data) {
  if (data.rawCommand == 381 && !client3.sentConnect) {
    client3.sentConnect = true;
    client3.send('CONNECT', 'server4', 'password');

    // Now test the link
    setTimeout(function() {
      client3.say('#test', 'Hello world');
    }, 250);
  }
});

setTimeout(function() {
  console.log('Map 1:');
  console.log(server1.servers.stringValue());
  console.log('Map 2:');
  console.log(server2.servers.stringValue());
  console.log('Map 3:');
  console.log(server3.servers.stringValue());
  console.log('Map 4:');
  console.log(server4.servers.stringValue());
}, 5000);
