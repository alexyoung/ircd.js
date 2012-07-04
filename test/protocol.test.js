var path = require('path')
  , assert = require('assert')
  , protocol = require(path.join(__dirname, '..', 'lib', 'protocol'))
  , invalidNick = protocol.validations.invalidNick
  , invalidChannel = protocol.validations.invalidChannel
  , invalidChannelKey = protocol.validations.invalidChannelKey
  ;

module.exports = {
  'Protocol': {
    'test nickname validation': function(done) {
      // Valid nicknames
      assert.strictEqual('alexyoung'.match(invalidNick), null);
      assert.strictEqual('AbC123'.match(invalidNick), null);
      assert.strictEqual('a{b[}]'.match(invalidNick), null);

      // Invalid nicknames
      // Nicknames shall not contain some special characters
      assert.notStrictEqual('abc#'.match(invalidNick), null);
      assert.notStrictEqual('abc*defg'.match(invalidNick), null);
      assert.notStrictEqual('abc~'.match(invalidNick), null);
      assert.notStrictEqual('a\0a'.match(invalidNick), null, 'NULL');
      assert.notStrictEqual('abc\ndefg'.match(invalidNick), null, 'LF');
      assert.notStrictEqual('abc\7xyz'.match(invalidNick), null, 'BELL');

      // Invalid nicknames
      // RFC1459 says nicks must start with a letter
      // https://github.com/alexyoung/ircd.js/blob/5d7443847311d4d6d1ff7371fa1fdee021315b0f/doc/rfc1459.txt#L492
      assert.notStrictEqual('9abc'.match(protocol.validations.invalidNick), null, 'starting with a digit');
      assert.notStrictEqual('^abc123'.match(protocol.validations.invalidNick), null, 'starting with a special character');

      done();
    },

    'test channelname validation': function(done) {
      // Valid channelnames
      assert.strictEqual('node.js'.match(invalidChannel), null);
      assert.strictEqual('#9'.match(invalidChannel), null);
      assert.strictEqual('bla\u01D2'.match(invalidChannel), null, 'random 8 bit character');

      // Invalid channelnames
      // https://github.com/alexyoung/ircd.js/blob/5d7443847311d4d6d1ff7371fa1fdee021315b0f/doc/rfc1459.txt#L494
      assert.notStrictEqual('word1 word2'.match(invalidChannel), null, 'SPACE');
      assert.notStrictEqual('ring\x07'.match(invalidChannel), null, 'BELL');
      assert.notStrictEqual('zero\x00'.match(invalidChannel), null, 'NUL');
      assert.notStrictEqual('word\rword'.match(invalidChannel), null, 'CR');
      assert.notStrictEqual('word\nword'.match(invalidChannel), null, 'LF');
      assert.notStrictEqual('first,secound,third'.match(invalidChannel), null, 'Comma (,)');

      done();
    },

    'test channelkey validation': function(done) {
      // Valid channelkeys
      assert.strictEqual('key'.match(invalidChannelKey), null);
      assert.strictEqual('key*'.match(invalidChannelKey), null);

      // Invalid channelkeys
      // any 7-bit US_ASCII character is valid, except NUL, CR, LF, FF, h/v TABs, and " "
      assert.notStrictEqual('bla\u01D2'.match(invalidChannelKey), null, 'random 8 bit character');
      assert.notStrictEqual('zero\x00'.match(invalidChannelKey), null, 'NUL');
      assert.notStrictEqual('word\rword'.match(invalidChannelKey), null, 'CR');
      assert.notStrictEqual('word\nword'.match(invalidChannelKey), null, 'LF');
      assert.notStrictEqual('word\x0C'.match(invalidChannelKey), null, 'FF');
      assert.notStrictEqual('horizontal\x09vertical\x0B'.match(invalidChannelKey), null, 'tabs');
      assert.notStrictEqual('space s'.match(invalidChannelKey), null, 'SPACE')

      done();
    }
  }
};
