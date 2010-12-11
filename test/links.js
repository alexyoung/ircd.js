var assert = require('assert'),
    path = require('path'),
    Server = require(path.join(__dirname, '..', 'src', 'server')).ircServer,
    events = require('events'),
    testEmitter = new events.EventEmitter(),
    server1 = new Server(),
    server2 = new Server();

server1.config = { "network":  "ircn",
  "hostname": "localhost",
  "serverDescription": "A Node IRC daemon",
  "serverName": "server1",
  "port": 6667,
  "linkPort": 7777,
  "whoWasLimit": 10000,
  "token": 1,
  "opers": {
    "alex": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" }
  },
  "links": {
    "server2": { "host": "127.0.0.1",
                 "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                 "port": 7778,
                 "token": 2 }
  }
};

server2.config = { "network":  "ircn",
  "hostname": "localhost",
  "serverDescription": "Another Node IRC daemon",
  "serverName": "server2",
  "whoWasLimit": 10000,
  "port": 8000,
  "linkPort": 7778,
  "token": 2,
  "opers": {
    "alex": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" }
  },
  "links": {
    "server1": { "host": "127.0.0.1",
                 "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                 "port": 7777,
                 "token": 1 }
  }
};

server1.start();
server2.start();

// TODO: Make a client join, oper, then link the two servers
//       and fix the other tests

