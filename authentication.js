const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const TotpStrategy = require('passport-totp').Strategy;
const redisPkg = require('redis');

const config = require('./config');
var redis = redisPkg.createClient({prefix: config.redisPrefix});

const users = require('./config').users;

passport.use(new LocalStrategy((username, password, done) => {
  var user = users.filter(u => (u.username == username && u.password == password));
  if (user.length == 0) {
    return done(null, false, {message: 'Incorrect credentials.'});
  }

  return done(null, user[0].username);
}));

passport.use(new TotpStrategy(async function(user, done) {
  try {
    var key = await redis.getAsync(`totp:${user}`);

    return done(null, key, 30);
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
