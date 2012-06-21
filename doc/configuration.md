# Configuring ircd.js

This is what a configuration file looks like:

        { "network":  "ircn",
          "hostname": "localhost",
          "serverDescription": "A Node IRC daemon",
          "serverName": "server1",
          "port": 6667,
          "whoWasLimit": 10000,
          "opers": {
            "alex": { "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8" }
          },
          "channels": {
            "channel1": { "topic": "First Channel" },
            "channel2": { "topic": "Second Channel" }
          },
          "links": {
            "server2": { "host": "127.0.0.1",
                         "password": "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
                         "port": 9999 }
          }
        }

* `network`: The name of your IRC network
* `hostname`: The hostname for your server
* `serverDescription`: A textual description of the server
* `serverName`: The name of the server
* `port`: The port the server should listen on
* `whoWasLimit`: The number of `WHOWAS` records to store in memory
* `opers`: A list of operators with bcrypted passwords (the `pwgen.js` script can encrypt passwords for you)
* `channels`: A list of channels that are created on startup.
* `links`: This is for other server links and can be ignored for now

## Configuration File Locations

These are the current configuration search paths:

* `/etc/ircdjs/config.json`
* `./config/config.json` (inside the source path)

## TLS

if `config.key` and `config.cert` is provided it will start a tls-server.

`config.{key,cert}` have to be paths to the key-files.
