const base32 = require('thirty-two');
const bluebird = require('bluebird');
const bodyParser = require('body-parser');
const express = require('express');
const morgan = require('morgan');
const nodemailer = require('nodemailer');
const redisPkg = require('redis');
const request = require('request-promise-native');
const session = require('express-session');
const uuid = require('uuid/v4');
const validator = require('validator');

bluebird.promisifyAll(redisPkg.RedisClient.prototype);
bluebird.promisifyAll(redisPkg.Multi.prototype);

const config = require('./config');
var RedisStore = require('connect-redis')(session);
var redis = redisPkg.createClient({prefix: config.redisPrefix});
var mailer = nodemailer.createTransport(config.emailTransport);
module.exports = ({redis, mailer});
var passport = require('./authentication');

var app = express();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

app.locals.config = config;
app.set('views', './views');
app.set('view engine', 'pug');
app.get('env') === 'development' && app.use(morgan('dev'));
app.use('/public', express.static('./public'));
app.use(bodyParser.urlencoded({
  limit: '5kb',
  extended: true
}));

// We need sessions for form errors
app.use(session({
  store: new RedisStore(),
  secret: config.secret
}));

// Display form
app.get('/', (req, res) => {
  var errors = req.session.errors;
  delete req.session.errors;

  res.render('step1', {errors});
});

// Handle form, create token to validate email adress and send link by email
app.post('/etape-1', wrap(async (req, res, next) => {
  if (!req.body.email || !validator.isEmail(req.body.email)) {
    req.session.errors = {};
    req.session.errors['email'] = 'Email invalide.';

    return res.redirect('/');
  }

  // If email does not exist, push in the list
  if (!await redis.exists(`${req.body.email}:valid`)) {
    await redis.lpushAsync('all', req.body.email);
  }

  var token = uuid();
  await redis.setAsync(token, req.body.email);
  await redis.setAsync(`${req.body.email}:valid`, false);

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
app.get('/etape-1/confirmation', (req, res) => {
  res.render('step1Confirm');
});

// Validate email address with token
app.get('/etape-1/confirmation/:token', wrap(async (req, res) => {
  var email = await redis.getAsync(req.params.token);
  if (!email) {
    return res.status(401).render('step2Invalid', {
      message: 'Ce lien est invalide ou périmé. Cela signifie probablement que vous\
      avez demandé et reçu un autre lien plus récement. Merci de vérifier dans\
      votre boîte mail.'
    });
  }

  req.session.email = email;
  await redis.setAsync(`${email}:valid`, true);

  res.redirect('/etape-2');
}));

// Form for step 2
app.get('/etape-2', wrap(async (req,res) => {
  if (!req.session.email) {
    return res.status(401).render('step2Invalid', {
      message: 'Vous devez cliquer sur le lien dans le mail que vous avez reçu\
      pour accéder à cette page.'
    });
  }

  var errors = req.session.errors;
  delete req.session.errors;

  var city = (await redis.getAsync(`${req.session.email}:city`));

  res.render('step2', {email: req.session.email, city, errors});
}));

// Handle form, send emails to random people
app.post('/etape-2', wrap(async (req, res) => {
  if (!req.body.commune)  { // req.body.commun should be city code INSEE
    req.session.errors = {};
    req.session.errors['commune'] = 'Ce champ ne peut être vide.';

    return res.redirect('/etape-2');
  }

  // Get city zipcodes
  var ban = await request({
    uri: 'https://api-adresse.data.gouv.fr/search/',
    qs: {
      q: req.body.commune,
      type: 'municipality',
      citycode: req.body.commune
    },
    json: true
  });

  if (!ban.features.length) { // if city does not exist, return to the form
    req.session.errors = {};
    req.session.errors['commune'] = 'Commune inconnue.';

    return res.redirect('/etape-2');
  }

  var zipcodes = ban.features.map(feature => (feature.properties.postcode));

  // Increment number of change so it cannot be greater than 3
  if (await redis.incrAsync(`${req.session.email}:changes`) > 3) {
    req.session.errors = {};
    req.session.errors['commune'] = 'Vous ne pouvez pas changer de commune plusieurs fois.';

    return res.redirect('/etape-2');
  }

  await redis.setAsync(`${req.session.email}:city`, `${ban.features[0].properties.city} (${ban.features[0].properties.context})`);
  await redis.setAsync(`${req.session.email}:zipcodes`, JSON.stringify(zipcodes));
  await redis.setAsync(`${req.session.email}:insee`, ban.features[0].properties.citycode);

  res.redirect('/etape-2/confirmation');
}));


app.get('/etape-2/confirmation', (req, res) => {
  res.render('end');
});

app.use(passport.initialize());
app.use(passport.session());
app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});
app.get('/login', (req, res) => {
  res.render('login');
});
app.post('/login', passport.authenticate('local', {successRedirect: '/login-totp', failureRedirect: '/login'}));
app.use('/', (req, res, next) => {
  if (!req.user && process.env.NODE_ENV !== 'test') return res.redirect('/login');

  next();
});
app.get('/login-totp', wrap(async (req, res) => {
  var qrImage = false;

  if (!await redis.getAsync(`totp:${req.user}:valid`)) {
    var key = (await redis.getAsync(`totp:${req.user}`)) || uuid();

    var otpUrl = `otpauth://totp/Procurations%20JLM2017:${req.user}?secret=${base32.encode(key)}&period=30`;
    qrImage = `https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=${encodeURIComponent(otpUrl)}`;
    await redis.setAsync(`totp:${req.user}`, key);
  }

  res.render('loginTotp', {qrImage});
}));
app.post('/login-totp', passport.authenticate('totp', {failureRedirect: '/login-totp'}), wrap(async (req, res) => {
  req.session.totp = true;
  await redis.setAsync(`totp:${req.user}:valid`, true);

  res.redirect('/admin');
}));

app.use('/admin', wrap(async (req, res, next) => {
  if (!req.session.totp && process.env.NODE_ENV !== 'test') return res.redirect('/login-totp');
  if (process.env.NODE_ENV === 'test') req.user = 'test';
  res.locals.user = req.user;

  return next();
}), require('./admin'));

app.listen(process.env.PORT || 3000, '127.0.0.1', (err) => {
  if (err) return console.error(err);

  console.log('Listening on http://localhost:' + (process.env.PORT || 3000));
});
