var assert = require('assert'),
    path = require('path'),
    User = require(path.join(__dirname, '..', 'lib', 'user')).User,
    testCase = require('nodeunit').testCase;

module.exports = {
  'test timeout calculation': function(test) {
    var server = {
          config: { idleTimeout: 60 }
        }
      , user = new User(null, server);

    assert.ok(!user.hasTimedOut());
    user.lastPing = (Date.now() - 60001);
    assert.ok(user.hasTimedOut());

    test.done();
  }
};
