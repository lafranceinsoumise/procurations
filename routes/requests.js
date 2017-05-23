const express = require('express');
const httpRequest = require('request-promise-native');
const RateLimit = require('express-rate-limit');
const uuid = require('uuid/v4');
const validator = require('validator');

var config = require('../config');
const {saveCityInformation} = require('../lib/actions');
var {db, mailer} = require('../index');
var router = express.Router();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

var limiter = new RateLimit({
  windowMs: 60*1000, // 15 minutes
  max: 3
});

/**
 * Home page
 */
router.get('/', (req, res) => {
  var errors = req.session.errors;
  delete req.session.errors;

  res.render('step1', {errors});
});

/**
 * Handle form with request email
 */
router.post('/etape-1', limiter, wrap(async (req, res, next) => {
  if (!req.body.email || !validator.isEmail(req.body.email)) {
    req.session.errors = {};
    req.session.errors['email'] = 'Email invalide.';

    return res.redirect('/');
  }

  req.body.email = req.body.email.toLowerCase();

  var token = uuid();

  var request = await db.get('SELECT * FROM requests WHERE email = ?', req.body.email);
  if (request) {
    await db.run('UPDATE requests SET token = ? WHERE id = ?', token, request.id);
  } else {
    await db.run('INSERT INTO requests (email, token) VALUES (?, ?)', req.body.email, token);
  }

  var emailContent = await httpRequest({
    uri: config.mails.step1,
    qs: {
      EMAIL: req.body.email,
      LINK: `${config.host}/etape-1/confirmation/${token}`
    }
  });

  var mailOptions = Object.assign({
    to: req.body.email,
    subject: 'Votre procuration',
    html: emailContent
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err) return next(err);

    res.redirect('/etape-1/confirmation');
  });
}));

/**
 * Thank you page for step 1
 * the user must now click in the email she receive
 * to validate her email address
 */
router.get('/etape-1/confirmation', (req, res) => {
  res.render('step1Confirm');
});

/**
 * Validate email address and redirect to second form
 */
router.get('/etape-1/confirmation/:token', wrap(async (req, res) => {
  var request = await db.get('SELECT * FROM requests WHERE token = ?', req.params.token);
  if (!request) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récemment. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  req.session.requestId = request.id;
  await db.run('UPDATE requests SET validation = ? WHERE id = ?', new Date(), request.id);

  res.redirect('/etape-2');
}));

/**
 * Stop requests already matched
 */
router.use('/etape-2', wrap(async (req, res, next) => {
  if (!req.session.requestId) {
    return res.status(401).render('errorMessage', {
      message: 'Vous devez cliquer sur le lien dans le mail que vous avez reçu\
      pour accéder à cette page.'
    });
  }

  if (await db.get('SELECT * FROM matches WHERE request_id = ?', req.session.requestId)) {
    return res.status(401).render('errorMessage', {
      message: 'Vous avez déjà reçu un mail vous indiquant comment prendre contact\
      avec la personne qui prendra votre procuration.'
    });
  }

  next();
}));

/**
 * Fill information to complete requests
 */
router.get('/etape-2', wrap(async (req,res) => {
  var errors = req.session.errors;
  delete req.session.errors;

  var request = (await db.get('SELECT * FROM requests WHERE id = ?', req.session.requestId));

  var communeString;
  if (request.insee) var city = await db.get('SELECT * FROM cities WHERE insee = ?', request.insee);
  if (city) communeString = `${city.name} (${city.context})`;

  res.render('step2', {request, communeString, errors});
}));

/**
 * Handle form for request completion
 */
router.post('/etape-2', wrap(async (req, res) => {
  if (!req.body.commune)  { // req.body.commun should be commune code INSEE
    req.session.errors = {};
    req.session.errors['commune'] = 'Ce champ ne peut être vide.';

    return res.redirect('/etape-2');
  }

  // Get commune zipcodes
  var ban = await httpRequest({
    uri: 'https://api-adresse.data.gouv.fr/search/',
    qs: {
      q: req.body.commune,
      type: 'municipality',
      citycode: req.body.commune
    },
    json: true
  });

  if (!ban.features.length) { // if commune does not exist, return to the form
    req.session.errors = {};
    req.session.errors['commune'] = 'Commune inconnue.';

    return res.redirect('/etape-2');
  }

  var zipcodes = ban.features.map(feature => (feature.properties.postcode));
  const insee = ban.features[0].properties.citycode;
  const name = ban.features[0].properties.city;
  const context = ban.features[0].properties.context;

  if ((await db.get('SELECT changes FROM requests WHERE id = ?', req.session.requestId)).changes > 2) {
    req.session.errors = {};
    req.session.errors['commune'] = 'Vous ne pouvez pas changer de commune plusieurs fois.';

    return res.redirect('/etape-2');
  }

  // TODO

  await saveCityInformation(insee, {name, context, zipcodes});

  // Increment number of change so it cannot be greater than 3
  await db.run('UPDATE requests SET\
    changes = changes + 1,\
    insee = ?,\
    completion = ?\
    WHERE id = ?', insee, new Date(), req.session.requestId
  );

  res.redirect('/etape-2/confirmation');
}));

/**
 * Thank you page for complete request
 * TODO: Add a thank you mail.
 */
router.get('/etape-2/confirmation', (req, res) => {
  res.render('end');
});

/**
 * Alternative form for listes consulaires
 * @type {[type]}
 */
router.get('/etape-2-liste-consulaire', wrap(async (req,res) => {
  var errors = req.session.errors;
  delete req.session.errors;

  var request = (await db.get('SELECT * FROM requests WHERE id = ?', req.session.requestId));

  var communeString;
  if (request.insee) var city = await db.get('SELECT * FROM cities WHERE insee = ?', request.insee);
  if (city) communeString = `${city.name} (${city.context})`;

  res.render('step2-liste-consulaire', {email: req.session.email, communeString, errors});
}));

router.post('/etape-2-liste-consulaire', wrap(async (req, res, next) => {
  if (!req.body.liste)  { // one should be filled
    req.session.errors = {};
    req.session.errors['liste'] = 'Ce champ ne peut être vide.';

    return res.redirect('/step2-liste-consulaire');
  }

  var mailOptions = Object.assign({
    to: config.lecDest,
    subject: `Demande LEC (${req.session.email} - ${req.body.liste})`,
    text: `Boujour,\n\nNouvelle demande de procuration de ${req.session.email} pour la liste ${req.body.liste}.`
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err) return next(err);

    res.redirect('/etape-2/confirmation');
  });
}));

/**
 * Lea mandant confirme qu'iel a bien reçu les infos et a fait sa procuration.
 */
router.get('/confirmation/:token', wrap(async (req, res) => {
  var match = await db.get('SELECT id FROM matches WHERE request_confirmation_token = ?', req.params.token);
  if (!match) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récemment. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  await db.run('UPDATE matches SET request_confirmation = ? WHERE request_confirmation_token = ?', new Date(), req.params.token);

  return res.redirect('/confirmation');
}));

/**
 * Lea mandant n'a jamais pu contacter son mandataire, ou ne veut plus faire
 * de procuration, elle souhaite annuler.
 */
router.get('/annulation/:token', wrap(async (req, res) => {
  var match = await db.get('SELECT * FROM matches WHERE request_cancel_token = ?', req.params.token);

  if (!match) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récemment. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  return res.render('annulation');
}));

/**
 * Formulaire d'annulation de la route précédente
 */
router.post('/annulation/:token', wrap(async (req, res) => {
  if (!('type' in req.body)) {
    return res.statusCode(400).end();
  }

  var match = await db.get('SELECT * FROM matches WHERE request_cancel_token = ?', req.params.token);
  let {changes} = await db.run('DELETE FROM matches WHERE request_cancel_token = ?', req.params.token);

  if (changes == 0) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récemment. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  // supprimer le mandant si l'utilisateur l'a demandé
  if (req.body.type === 'delete') {
    await db.run('DELETE FROM requests WHERE id = ?', match.request_id);
  }

  return res.render('annulationConfirmation', {deleted: req.body.type === 'delete'});
}));

module.exports = router;
