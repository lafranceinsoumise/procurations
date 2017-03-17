const express = require('express');
const request = require('request-promise-native');
const uuid = require('uuid/v4');
const validator = require('validator');

var config = require('../config');
var {redis, mailer, consts} = require('../index');
var router = express.Router();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

router.get('/', (req, res) => {
  var errors = req.session.errors;
  delete req.session.errors;

  res.render('step1', {errors});
});

// Handle form, create token to validate email adress and send link by email
router.post('/etape-1', wrap(async (req, res, next) => {
  if (!req.body.email || !validator.isEmail(req.body.email)) {
    req.session.errors = {};
    req.session.errors['email'] = 'Email invalide.';

    return res.redirect('/');
  }

  // If email does not exist, push in the list
  if (!await redis.getAsync(`requests:${req.body.email}:valid`)) {
    await redis.lpushAsync('requests:all', req.body.email);
  }

  var token = uuid();
  await redis.setAsync(`requests:${token}`, req.body.email);
  await redis.setAsync(`requests:${req.body.email}:valid`, false);

  var emailContent = await request({
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

// Thanks you page for step 1
router.get('/etape-1/confirmation', (req, res) => {
  res.render('step1Confirm');
});

// Validate email address with token
router.get('/etape-1/confirmation/:token', wrap(async (req, res) => {
  var email = await redis.getAsync(`requests:${req.params.token}`);
  if (!email) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récement. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  req.session.email = email;
  await redis.setAsync(`requests:${email}:valid`, new Date());

  res.redirect('/etape-2');
}));

// Form for step 2
router.use('/etape-2', wrap(async (req, res, next) => {
  if (!req.session.email) {
    return res.status(401).render('errorMessage', {
      message: 'Vous devez cliquer sur le lien dans le mail que vous avez reçu\
      pour accéder à cette page.'
    });
  }

  if (await redis.getAsync(`requests:${req.session.email}:match`)) {
    return res.status(401).render('errorMessage', {
      message: 'Vous avez déjà reçu un mail vous indiquant comment prendre contact\
      avec la personne qui prendra votre procuration.'
    });
  }

  next();
}));

router.get('/etape-2', wrap(async (req,res) => {
  var errors = req.session.errors;
  delete req.session.errors;

  var commune = (await redis.getAsync(`requests:${req.session.email}:commune`));

  res.render('step2', {email: req.session.email, commune, errors});
}));

// Handle form, send emails to random people
router.post('/etape-2', wrap(async (req, res) => {
  if (!req.body.commune)  { // req.body.commun should be commune code INSEE
    req.session.errors = {};
    req.session.errors['commune'] = 'Ce champ ne peut être vide.';

    return res.redirect('/etape-2');
  }

  // Get commune zipcodes
  var ban = await request({
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

  // Increment number of change so it cannot be greater than 3
  if (await redis.incrAsync(`requests:${req.session.email}:changes`) > 3) {
    req.session.errors = {};
    req.session.errors['commune'] = 'Vous ne pouvez pas changer de commune plusieurs fois.';

    return res.redirect('/etape-2');
  }

  await redis.setAsync(`requests:${req.session.email}:commune`, `${ban.features[0].properties.city} (${ban.features[0].properties.context})`);
  await redis.setAsync(`requests:${req.session.email}:zipcodes`, JSON.stringify(zipcodes));
  await redis.setAsync(`requests:${req.session.email}:insee`, ban.features[0].properties.citycode);

  res.redirect('/etape-2/confirmation');
}));


router.get('/etape-2/confirmation', (req, res) => {
  res.render('end');
});

router.get('/confirmation/:token', wrap(async (req, res) => {
  var email = await redis.getAsync(`requests:confirmations:${req.params.token}`);
  if (!email) {
    return res.status(401).render('errorMessage', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récement. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  var flags = await redis.getAsync(`requests:${email}:posted`);
  await redis.setAsync(`requests:${email}:posted`, flags | consts.requestHasConfirm);

  return res.redirect('/confirmation');
}));

module.exports = router;
