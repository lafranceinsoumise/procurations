const express = require('express');

var redis = require('./index').redis;
var router = express.Router();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

router.get('/:page?', wrap(async (req, res) => {
  var page = (req.params && req.params.page) || 1;

  var perPage = 1000;
  var list = await redis.lrangeAsync('all', perPage * (page - 1), perPage * page - 1);

  list = await Promise.all(list.map(async (email) => {
    var valid = await redis.getAsync(`${email}:valid`);

    if (valid) {
      var city = await redis.getAsync(`${email}:city`);
    }

    if (city) {
      var matching = await redis.getAsync(`${email}:match`);
    }

    if (matching) {
      var posted = await redis.getAsync(`${email}:matching`);
    }

    return {email, valid, city, matching, posted};
  }));

  var total = await redis.llenAsync('all');

  res.render('admin', {list, total});
}));

module.exports = router;
