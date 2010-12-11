var crypto = require('crypto');

exports['sha1'] = function(data, salt) {
  if (typeof salt != 'undefined') {
    return crypto.createHmac('sha1', salt).update(data).digest('hex');
  } else {
    return crypto.createHash('sha1').update(data).digest('hex');
  }
};
