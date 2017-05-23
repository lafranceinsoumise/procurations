const express = require('express');

const db = require('../lib/sqlite');

var router = express.Router();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

router.get('/', (req, res) => res.redirect('/admin/requests'));

router.get('/requests/:page?', wrap(async (req, res) => {
  var page = (req.params && req.params.page) || 1;

  var perPage = 100;
  var list = await db.all('SELECT * FROM requests LIMIT 100 OFFSET ?', perPage*(page-1));
  var {total} = await db.get('SELECT COUNT(id) AS total FROM requests');

  res.render('admin/requests', {list, total});
}));

router.get('/:type/:page?', wrap(async (req, res) => {
  if (['invitations', 'offers'].indexOf(req.params.type) === -1) {
    return res.sendStatus(404);
  }

  var page = (req.params && req.params.page) || 1;

  var perPage = 100;
  var list = await db.all('SELECT * FROM invitations LIMIT 100 OFFSET ?', perPage*(page-1));
  var {total} = await db.get('SELECT COUNT(id) AS total FROM invitations');

  res.render('admin/offers', {list, total, type: req.params.type});
}));

module.exports = router;
