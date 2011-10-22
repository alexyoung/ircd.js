#!/usr/bin/env node
var ircd = require(__dirname + '/../lib/ircd');
ircd.hash(process.argv[2], function(err, hash) {
  if (err) {
    throw(err);
  } else {
    console.log(hash);
  }
});
