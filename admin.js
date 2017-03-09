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

  var perPage = 3;
  var list = await redis.lrangeAsync('all', perPage * (page - 1), perPage * page - 1);

  list = await Promise.all(list.map(async (email) => {
    var valid = await redis.existsAsync(`${email}:valid`);

    if (valid) {
      var city = await redis.getAsync(`${email}:city`);
    }

    return {email, valid, city};
  }));

  var total = await redis.llenAsync('all');

  res.render('admin', {list, total});
}));

module.exports = router;
