const express = require('express');
const moment = require('moment');
const request = require('request-promise-native');
const uuid = require('uuid/v4');
const validator = require('validator');

var {redis, mailer, consts} = require('../index');
var config = require('../config');
var router = express.Router();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

// Part for offers
router.get('/procuration/:token', wrap(async (req, res) => {
  var email = await redis.getAsync(`invitations:${req.params.token}`);
  if (!email) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récement. Merci de vérifier dans\
      votre boîte de réception.'
    });
  }

  if (await redis.getAsync(`offers:${email}:match`)) {
    return res.status(401).render('errorMessage', {
      message: 'Un e-mail a déjà été envoyé à la personne qui souhaite vous\
      donner sa procuration. Elle vous contactera pour confirmation.'
    });
  }

  req.session.email = email;

  if (await redis.getAsync(`offers:${email}:match`)) {
    return res.redirect('/confirmation');
  }

  return res.redirect('/procuration');
}));

router.use('/procuration', wrap(async (req, res, next) => {
  if (!req.session.email) {
    return res.status(401).render('errorMessage', {
      message: 'Vous devez cliquer sur le lien dans le mail que vous avez reçu\
      pour accéder à cette page.'
    });
  }

  next();
}));

router.get('/procuration', (req, res) => {
  var errors = req.session.errors;
  var form = req.session.form;
  delete req.session.errors;
  delete req.session.form;

  res.render('procuration', {email: req.session.email, errors, form});
});

router.post('/procuration', wrap(async (req, res) => {
  if (!req.session.email) {
    return res.sendStatus(401);
  }

  req.session.errors = {};
  if (!req.body.first_name || !validator.isLength(req.body.first_name, {min: 1, max: 300})) {
    req.session.errors['first_name'] = 'Prénom invalide.';
  }
  if (!req.body.last_name || !validator.isLength(req.body.last_name, {min: 1, max: 300})) {
    req.session.errors['last_name'] = 'Nom invalide.';
  }
  if (!req.body.date || !moment(req.body.date, 'DD/MM/YYYY').isValid()) {
    req.session.errors['date'] = 'Date invalide.';
  }
  if (!req.body.zipcode || !validator.matches(req.body.zipcode, /^\d{5}$/)) {
    req.session.errors['zipcode'] = 'Code postal invalide';
  }
  if (!req.body.address1 || !validator.isLength(req.body.address1, {min: 5, max: 500})) {
    req.session.errors['address'] = 'Adresse invalide.';
  }
  if (!validator.isLength(req.body.address2 || '', {min: 0, max: 500})) {
    req.session.errors['address'] = 'Adresse invalide.';
  }
  if (!req.body.phone || !validator.isMobilePhone(req.body.phone, 'fr-FR')) {
    req.session.errors['phone'] = 'Numéro invalide.';
  }

  var ban = await request({
    uri: `https://api-adresse.data.gouv.fr/search/?q=${req.body.commune}&type=municipality&citycode=${req.body.commune}&postcode=${req.body.zipcode}`,
    json: true
  });

  if (!ban.features.length) {
    req.session.errors['commune'] = 'Pas de commune avec ce code postal.';
  }

  if (Object.keys(req.session.errors).length > 0) {
    req.session.form = req.body;
    return res.redirect('/procuration');
  }

  delete req.session.errors;

  // if new offer, add in the list of the commune
  if (!await redis.getAsync(`offers:${req.session.email}`)) {
    await redis.rpushAsync(`offers:${req.body.commune}`, req.session.email);
    await redis.rpushAsync('offers:all', req.session.email);
  }

  await redis.setAsync(`offers:${req.session.email}`, JSON.stringify({
    email: req.session.email,
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    phone: req.body.phone,
    date: req.body.date,
    zipcode: req.body.zipcode,
    address1: req.body.address1,
    address2: req.body.address2,
    commune: req.body.commune
  }));

  return res.redirect('/merci');
}));

router.get('/merci', (req, res) => {
  return res.render('procurationConfirm');
});

router.get('/procuration/confirmation/:token', wrap(async (req, res, next) => {
  var email = await redis.getAsync(`offers:confirmations:${req.params.token}`);
  if (!email) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récement. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  var offer = JSON.parse(await redis.getAsync(`offers:${email}`));
  var matchEmail = await redis.getAsync(`offers:${email}:match`);
  var commune = await redis.getAsync(`requests:${matchEmail}:commune`);

  var address = `${offer.address1}<br>`;
  if (offer.address2) address += `${offer.address1}<br>`;
  address += `${offer.zipcode}<br>${commune}`;

  var token = uuid();
  await redis.setAsync(`requests:confirmations:${token}`, matchEmail);
  var mail2Options = Object.assign({
    to: matchEmail,
    subject: `${offer.first_name} ${offer.last_name} vous envoie les informations pour votre procuration !`,
    html: await request({
      url: config.mails.matchInformations,
      qs: {
        EMAIL: matchEmail,
        FIRST_NAME: offer.first_name,
        LAST_NAME: offer.last_name,
        COMMUNE: commune,
        ADDRESS: address,
        BIRTH_DATE: offer.date,
        LINK: `${config.host}/confirmation/${token}`
      },
    })
  }, config.emailOptions);

  mailer.sendMail(mail2Options, async (err) => {
    if (err) next(err);

    var flags = await redis.getAsync(`requests:${matchEmail}:posted`);
    await redis.setAsync(`requests:${matchEmail}:posted`, flags | consts.offerHasConfirm);

    return res.redirect('/confirmation');
  });
}));

module.exports = router;
