var bcrypt = require('bcrypt');

module.exports = {
  hash: function(text, fn) {
    bcrypt.hash(text, 10, function(err, hash) {
      fn(err, hash);
    });
  },

  compareHash: bcrypt.compare
};
