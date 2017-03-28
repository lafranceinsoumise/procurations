const bluebird = require('bluebird');
const nodemailer = require('nodemailer');
const redisPkg = require('redis');
const request = require('request-promise-native');
const uuid = require('uuid/v4');

bluebird.promisifyAll(redisPkg.RedisClient.prototype);
bluebird.promisifyAll(redisPkg.Multi.prototype);

const config = require('../config');
var redis = redisPkg.createClient({prefix: config.redisPrefix});
var mailer = nodemailer.createTransport(config.emailTransport);
module.exports = ({redis, mailer});

const askTenMorePeople = require('./ask');


// Iterate people looking for offers
async function iterate() {
  console.log('new iteration of all requests');
  var cursor = 0;
  var emails;

  // Iterate redis SCAN
  for(;;) {
    [cursor, emails] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}requests:*:zipcodes`, 'COUNT', '99');

    for (var i = 0; i < emails.length; i++) {
      var email = emails[i].match(`${config.redisPrefix}requests:(.*):zipcodes`)[1];
      // If already matched, skip
      if (await redis.getAsync(`requests:${email}:match`)) continue;

      // Find someoneInTheQueue
      var insee = await redis.getAsync(`requests:${email}:insee`);
      var someoneInTheQueue = await redis.lpopAsync(`offers:${insee}`);

      if (someoneInTheQueue) {
        await match(email, someoneInTheQueue);
        continue;
      }

      // If nothing found, ask ten more people
      var zipcodes = await redis.getAsync(`requests:${email}:zipcodes`);
      await askTenMorePeople(zipcodes);
    }

    if (cursor == '0') {
      break;
    }
  }
}

/**
 * [match description]
 * @param  {String}  email
 * @param  {Object}  someone
 * @param  {String}  someone.email
 * @param  {String}  someone.first_name
 * @param  {String}  someone.last_name
 * @param  {String}  someone.date
 * @param  {String}  someone.adresse1
 * @param  {String}  someone.adresse2
 * @param  {String}  someone.zipcode
 * @param  {String}  someone.commune
 * @return {Promise}
 */
async function match(requestEmail, offerEmail) {
  await redis.setAsync(`requests:${requestEmail}:match`, offerEmail);
  await redis.setAsync(`requests:${requestEmail}:matchDate`, new Date());
  await redis.setAsync(`offers:${offerEmail}:match`, requestEmail);
  console.log(`${requestEmail} : matched to ${offerEmail}`);

  var commune = await redis.getAsync(`requests:${requestEmail}:commune`);
  var offer = JSON.parse(await redis.getAsync(`offers:${offerEmail}`));

  var token = uuid();
  await redis.setAsync(`requests:confirmations:${token}`, requestEmail);
  var mailOptions = Object.assign({
    to: requestEmail, // list of receivers
    subject: 'Quelqu\'un peut prendre votre procuration !', // Subject line
    html: await request({
      url: config.mails.requestMatch,
      qs: {
        EMAIL: requestEmail,
        PHONE: offer.phone,
        FIRST_NAME: offer.first_name,
        COMMUNE: commune,
        LINK: `${config.host}/confirmation/${token}`
      }
    })
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err) console.error(err.stack);
  });

  token = uuid();
  await redis.setAsync(`offers:confirmations:${token}`, offerEmail);
  var address = `${offer.address1}<br>`;
  if (offer.address2) address += `${offer.address1}<br>`;
  address += `${offer.zipcode}<br>${commune}`;

  var mail2Options = Object.assign({
    to: offerEmail,
    subject: 'Quelqu\'un veut que vous preniez sa procuration !',
    html: await request({
      url: config.mails.offerMatch,
      qs: {
        EMAIL: offerEmail,
        FIRST_NAME: offer.first_name,
        LAST_NAME: offer.last_name,
        COMMUNE: commune,
        ADDRESS: address,
        BIRTH_DATE: offer.date,
        LINK: `${config.host}/procuration/confirmation/${token}`
      },
    })
  }, config.emailOptions);

  mailer.sendMail(mail2Options, (err) => {
    if (err) console.error(err.stack);
  });
}

iterate()
  .then(() => {
    console.log('iteration finished');

    redis.quit();
  })
  .catch((err) => console.error(err.stack));
