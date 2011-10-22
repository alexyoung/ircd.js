var bcrypt = require('bcrypt');

module.exports = {
  hash: function(text, fn) {
    bcrypt.gen_salt(10, function(err, salt) {
      bcrypt.encrypt(text, salt, function(err, hash) {
        fn(err, hash);
      });
    });
  },

  compareHash: bcrypt.compare
};
