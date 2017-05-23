const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const TotpStrategy = require('passport-totp').Strategy;

const db = require('./lib/sqlite');

passport.use(new LocalStrategy(async (username, password, done) => {
  var user = await db.get('SELECT * FROM admins WHERE username = ? AND password = ?', username, password);
  if (!user) {
    return done(null, false, {message: 'Incorrect credentials.'});
  }

  return done(null, user.username);
}));

passport.use(new TotpStrategy(async function(username, done) {
  try {
    var {totp} = await db.get('SELECT * FROM admins WHERE username = ?', username);

    return done(null, totp, 30);
  } catch (err) {
    done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

module.exports = passport;
