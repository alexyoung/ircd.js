#!/usr/bin/env node
var sha1 = require('../lib/hash').sha1;
console.log(sha1(process.argv[2]));
