var path = require('path'),
  assert = require('assert'),
  protocol = require(path.join(__dirname, '..', 'lib', 'protocol')),
  invalidNick = protocol.validations.invalidNick,
  invalidChannel = protocol.validations.invalidChannel,
  invalidChannelKey = protocol.validations.invalidChannelKey;

exports['nickname validation'] = function(test) {
  // Valid nicknames
  test.strictEqual('alexyoung'.match(invalidNick), null);
  test.strictEqual('AbC123'.match(invalidNick), null);
  test.strictEqual('a{b[}]'.match(invalidNick), null);

  // Invalid nicknames
  // Nicknames shall not contain some special characters
  test.notStrictEqual('abc#'.match(invalidNick), null);
  test.notStrictEqual('abc*defg'.match(invalidNick), null);
  test.notStrictEqual('abc~'.match(invalidNick), null);
  test.notStrictEqual('a\0a'.match(invalidNick), null, 'NULL');
  test.notStrictEqual('abc\ndefg'.match(invalidNick), null, 'LF');
  test.notStrictEqual('abc\7xyz'.match(invalidNick), null, 'BELL');

  // Invalid nicknames
  // RFC1459 says nicks must start with a letter
  // https://github.com/alexyoung/ircd.js/blob/5d7443847311d4d6d1ff7371fa1fdee021315b0f/doc/rfc1459.txt#L492
  test.notStrictEqual('9abc'.match(protocol.validations.invalidNick), null, 'starting with a digit');
  test.notStrictEqual('^abc123'.match(protocol.validations.invalidNick), null, 'starting with a special character');

  test.done();
};

exports['channelname validation'] = function(test) {
  // Valid channelnames
  test.strictEqual('node.js'.match(invalidChannel), null);
  test.strictEqual('#9'.match(invalidChannel), null);
  test.strictEqual('bla\u01D2'.match(invalidChannel), null, 'random 8 bit character');

  // Invalid channelnames
  // https://github.com/alexyoung/ircd.js/blob/5d7443847311d4d6d1ff7371fa1fdee021315b0f/doc/rfc1459.txt#L494
  test.notStrictEqual('word1 word2'.match(invalidChannel), null, 'SPACE');
  test.notStrictEqual('ring\x07'.match(invalidChannel), null, 'BELL');
  test.notStrictEqual('zero\x00'.match(invalidChannel), null, 'NUL');
  test.notStrictEqual('word\rword'.match(invalidChannel), null, 'CR');
  test.notStrictEqual('word\nword'.match(invalidChannel), null, 'LF');
  test.notStrictEqual('first,secound,third'.match(invalidChannel), null, 'Comma (,)');

  test.done();
}

exports['channelkey validation'] = function(test) {
  // Valid channelkeys
  test.strictEqual('key'.match(invalidChannelKey), null);
  test.strictEqual('key*'.match(invalidChannelKey), null);

  // Invalid channelkeys
  // any 7-bit US_ASCII character is valid, except NUL, CR, LF, FF, h/v TABs, and " "
  test.notStrictEqual('bla\u01D2'.match(invalidChannelKey), null, 'random 8 bit character');
  test.notStrictEqual('zero\x00'.match(invalidChannelKey), null, 'NUL');
  test.notStrictEqual('word\rword'.match(invalidChannelKey), null, 'CR');
  test.notStrictEqual('word\nword'.match(invalidChannelKey), null, 'LF');
  test.notStrictEqual('word\x0C'.match(invalidChannelKey), null, 'FF');
  test.notStrictEqual('horizontal\x09vertical\x0B'.match(invalidChannelKey), null, 'tabs');
  test.notStrictEqual('space s'.match(invalidChannelKey), null, 'SPACE')

  test.done();
}

if(!module.parent) {
  assert.done = function() { };
  for(key in exports) {
    exports[key](assert);
  }
}
