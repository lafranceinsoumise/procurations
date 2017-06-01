const express = require('express');
const moment = require('moment');
const httpRequest = require('request-promise-native');
const validator = require('validator');

var {db, mailer} = require('../index');
const {getCityInformation} = require('../lib/actions');
var config = require('../config');
var router = express.Router();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

/**
 * Le mandataire accepte l'invitation
 * il va remplir ses informations pour être ajouté à la liste des offres
 */
router.get('/mandataire/:token', wrap(async (req, res) => {
  var invitation = await db.get('SELECT * FROM offers WHERE token = ?', req.params.token);
  if (!invitation) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récemment. Merci de vérifier dans\
      votre boîte de réception.'
    });
  }

  if (await db.get('SELECT * FROM matches WHERE offer_id = ?', invitation.id)) {
    return res.status(401).render('errorMessage', {
      message: 'Un e-mail a déjà été envoyé à la personne qui souhaite vous\
      donner sa procuration. Elle vous contactera pour confirmation.'
    });
  }

  req.session.invitation = invitation;

  /*if (await redis.getAsync(`offers:${email}:match`)) {
    return res.redirect('/confirmation');
  }*/

  return res.redirect('/mandataire');
}));

router.all('/mandataire', wrap(async (req, res, next) => {
  if (!req.session.invitation && !req.session.request) {
    return res.status(401).render('errorMessage', {
      message: 'Vous devez cliquer sur le lien dans le mail que vous avez reçu\
      pour accéder à cette page.'
    });
  }

  next();
}));

/**
 * Le futur mandataire rempli ses informations pour être ajouté à la liste
 * des offres
 */
router.get('/mandataire', (req, res) => {
  var errors = req.session.errors;
  var form = req.session.form;
  delete req.session.errors;
  delete req.session.form;

  res.render('procuration', {email: req.session.invitation.email, errors, form});
});

router.post('/mandataire', wrap(async (req, res) => {
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

  var communes = await httpRequest({
    uri: 'https://geo.api.gouv.fr/communes',
    qs: {
      code: req.body.commune
    },
    json: true
  });

  if (!communes.length) {
    req.session.errors = {};
    req.session.errors['commune'] = 'Commune inconnue.';

    return res.redirect('/etape-2');
  }
  // Get commune zipcodes
  var ban = await httpRequest({
    uri: 'https://api-adresse.data.gouv.fr/search/',
    qs: {
      q: communes[0].nom,
      type: 'municipality',
      citycode: req.body.commune
    },
    json: true
  });

  if (!ban.features.length) {
    req.session.errors['commune'] = 'Pas de commune avec ce code postal.';
  }

  if (Object.keys(req.session.errors).length > 0) {
    req.session.form = req.body;
    return res.redirect('/mandataire');
  }

  delete req.session.errors;

  console.log(req.session.invitation.id);
  await db.run('UPDATE offers SET \
    insee = ?,\
    first_name = ?,\
    last_name = ?,\
    phone = ?,\
    birth_date = ?,\
    zipcode = ?,\
    address1 = ?,\
    address2 = ?\
    WHERE id = ?',
    req.body.commune,
    req.body.first_name,
    req.body.last_name,
    req.body.phone,
    req.body.date,
    req.body.zipcode,
    req.body.address1,
    req.body.address2,
    req.session.invitation.id
  );

  return res.redirect('/merci');
}));

/**
 * Page de remerciement, l'utilisateur quitte le site
 */
router.get('/merci', (req, res) => {
  return res.render('procurationConfirm');
});


/**
 * Après le match, le mandataire confirme qu'il a été contacté par le mandant
 * cela envoie automatiquement les informations pour sa procuration
 */
router.get('/mandataire/confirmation/:token', wrap(async (req, res, next) => {
  var match = await db.get('SELECT * FROM matches WHERE offer_confirmation_token = ?', req.params.token);

  if (!match) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récemment. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  var request = await db.get('SELECT * FROM requests WHERE id = ?', match.request_id);
  var offer = await db.get('SELECT * FROM offers WHERE id = ?', match.offer_id);
  var city = await getCityInformation(request.insee);

  var address = `${offer.address1}<br>`;
  if (offer.address2) address += `${offer.address1}<br>`;
  address += `${offer.zipcode}<br>${city.name}`;

  var mail2Options = Object.assign({
    to: request.email,
    subject: `${offer.first_name} ${offer.last_name} vous envoie les informations pour votre procuration !`,
    html: await httpRequest({
      url: config.mails.matchInformations,
      qs: {
        EMAIL: request.email,
        FIRST_NAME: offer.first_name,
        LAST_NAME: offer.last_name,
        COMMUNE: city.name,
        ADDRESS: address,
        BIRTH_DATE: offer.birth_date,
        LINK: `${config.host}/confirmation/${match.request_confirmation_token}`,
        CANCEL_LINK: `${config.host}/annulation/${match.request_cancel_token}`
      },
    })
  }, config.emailOptions);

  mailer.sendMail(mail2Options, async (err) => {
    if (err) next(err);

    await db.run('UPDATE matches SET offer_confirmation = ? WHERE request_id = ? AND offer_id = ?',
      new Date(), request.id, offer.id);

    return res.redirect('/confirmation');
  });
}));

router.get('/mandataire/annulation/:token', wrap(async (req, res) => {
  var match = await db.get('SELECT * FROM matches WHERE offer_cancel_token = ?', req.params.token);

  if (!match) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récemment. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  await db.run('DELETE FROM matches WHERE offer_cancel_token = ?', req.params.token);
  await db.run('DELETE FROM offers WHERE id = ?', match.offer_id);

  return res.render('annulation_offre');
}));

module.exports = router;
