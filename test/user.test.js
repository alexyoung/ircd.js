var assert = require('assert')
  , path = require('path')
  , User = require(path.join(__dirname, '..', 'lib', 'user')).User
  ;

module.exports = {
  'User': {
    'test timeout calculation': function(done) {
      var server = {
            config: { idleTimeout: 60 }
          }
        , user = new User(null, server);

      assert.ok(!user.hasTimedOut());
      user.lastPing = (Date.now() - 61000);
      assert.ok(user.hasTimedOut());

      done();
    }
  }
};
