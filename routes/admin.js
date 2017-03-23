const express = require('express');

var redis = require('../index').redis;
var router = express.Router();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

router.get('/', (req, res) => res.redirect('/admin/requests'));

router.get('/requests/:page?', wrap(async (req, res) => {
  var page = (req.params && req.params.page) || 1;

  var perPage = 100;
  var list = await redis.lrangeAsync('requests:all', perPage * (page - 1), perPage * page - 1);

  list = await Promise.all(list.map(async (email) => {
    var valid = await redis.getAsync(`requests:${email}:valid`);

    if (valid) {
      var commune = await redis.getAsync(`requests:${email}:commune`);
    }

    if (commune) {
      var matching = await redis.getAsync(`requests:${email}:match`);
    }

    if (matching) {
      var posted = await redis.getAsync(`requests:${email}:posted`);
    }

    return {email, valid, commune, matching, posted};
  }));

  var total = await redis.llenAsync('requests:all');

  res.render('admin/requests', {list, total});
}));

router.get('/:type/:page?', wrap(async (req, res) => {
  if (['invitations', 'offers'].indexOf(req.params.type) === -1) {
    return res.sendStatus(404);
  }

  var page = (req.params && req.params.page) || 1;

  var perPage = 100;
  var list = await redis.lrangeAsync(`${req.params.type}:all`, perPage * (page - 1), perPage * page - 1);

  list = await Promise.all(list.map(async (email) => {
    var date = await redis.getAsync(`invitations:${email}:date`);
    var details = JSON.parse(await redis.getAsync(`offers:${email}`));

    if (details) {
      var matching = await redis.getAsync(`offers:${email}:match`);
    }

    return {email, date, details, matching};
  }));

  var total = await redis.llenAsync(`${req.params.type}:all`);

  res.render('admin/offers', {list, total, type: req.params.type});
}));

module.exports = router;
