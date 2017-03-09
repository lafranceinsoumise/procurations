const bluebird = require('bluebird');
const express = require('express');
const redisPkg = require('redis');

bluebird.promisifyAll(redisPkg.RedisClient.prototype);
bluebird.promisifyAll(redisPkg.Multi.prototype);

var config = require('./config');
var redis = redisPkg.createClient({prefix: config.redisPrefix});
var router = express.Router();
var wrap = module.exports = fn => (...args) => fn(...args).catch(args[2]);

router.get('/:page?', wrap(async (req, res) => {
  var page = (req.params && req.params.page) || 1;

  var list = await redis.lrangeAsync('all', 100 * (page - 1), 100);

  list = await Promise.all(list.map(async (email) => {
    var valid = await redis.existsAsync(`${email}:valid`);

    if (valid) {
      var city = await redis.getAsync(`${email}:city`);
    }

    return {email, valid, city};
  }));

  res.render('admin', {list});
}));

module.exports = router;
