const base32 = require('thirty-two');
const bodyParser = require('body-parser');
const express = require('express');
const helmet = require('helmet');
const htmlToText = require('nodemailer-html-to-text').htmlToText;
const morgan = require('morgan');
const session = require('express-session');
const uuid = require('uuid/v4');

const mailer = require('./lib/mailer');
const db = require('./lib/sqlite');

const config = require('./config');
var RedisStore = require('connect-redis')(session);
mailer.use('compile', htmlToText());
module.exports = ({db, mailer});
var passport = require('./authentication');

var app = express();
var wrap = fn => (...args) => fn(...args).catch(args[2]);

app.locals.config = config;
app.set('views', './views');
app.set('view engine', 'pug');
app.enable('trust proxy');
app.get('env') === 'development' && app.use(morgan('dev'));
app.use(helmet());
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

app.use('/', require('./routes/requests'));
app.use('/', require('./routes/offers'));

app.get('/confirmation', (req, res) => {
  return res.render('confirmation');
});

app.use(passport.initialize());
app.use(passport.session());
app.get('/logout', (req, res) => {
  req.session.destroy();
  req.logout();
  res.redirect('/');
});
app.get('/login', (req, res) => {
  res.render('login');
});
app.post('/login', passport.authenticate('local', {successRedirect: '/login-totp', failureRedirect: '/login'}));
app.use('/', (req, res, next) => {
  if (!req.user && process.env.SKIP_AUTH !== 'true') return res.redirect('/login');

  next();
});
app.get('/login-totp', wrap(async (req, res) => {
  var qrImage = false;

  if (!await db.get('SELECT totp_valid FROM users WHERE user = ?', req.user)) {
    var {totp: key} = (await db.get('SELECT totp FROM users WHERE user = ?', req.user)) || uuid();

    var otpUrl = `otpauth://totp/Procurations%20JLM2017:${req.user}?secret=${base32.encode(key)}&period=30`;
    qrImage = `https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=${encodeURIComponent(otpUrl)}`;
    await db.run('UPDATE users SET totp = ? WHERE user = ?', key, req.user);
  }

  res.render('loginTotp', {qrImage});
}));

app.post('/login-totp', passport.authenticate('totp', {failureRedirect: '/login-totp'}), wrap(async (req, res) => {
  req.session.totp = true;
  await db.run('UPDATE users SET totp_valid = 1 WHERE user = ?', req.user);

  res.redirect('/admin');
}));

app.use('/admin', wrap(async (req, res, next) => {
  if (!req.session.totp && process.env.SKIP_AUTH !== 'true') return res.redirect('/login-totp');
  if (process.env.SKIP_AUTH !== 'true') req.user = 'test';
  res.locals.user = req.user;

  return next();
}), require('./routes/admin'));

app.listen(process.env.PORT || 3000, '127.0.0.1', (err) => {
  if (err) return console.error(err);

  console.log('Listening on http://localhost:' + (process.env.PORT || 3000));
});
