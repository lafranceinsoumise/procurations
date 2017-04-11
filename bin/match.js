const request = require('request-promise-native');

const config = require('../config');
const redis = require('../lib/redis');
const mailer = require('../lib/mailer');
const {generateRequestConfirmationLink, generateOfferConfirmationLink, generateRequestCancelLink} = require('../lib/tokens');
const {saveMatch, getCityInformation, getOffer} = require('../lib/actions');

const {askMorePeople, mailReminder} = require('./ask');


// Iterate people looking for offers
async function iterate() {
  console.log('new iteration of all requests');
  var cursor = 0;
  var emails;
  var matchedEmail;

  const unmatchedRequestsByCommune = {};

  // Iterate redis SCAN
  for(;;) {
    [cursor, emails] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}requests:*:insee`, 'COUNT', '99');

    for (var i = 0; i < emails.length; i++) {
      var email = emails[i].match(`${config.redisPrefix}requests:(.*):insee`)[1];

      var insee = await redis.getAsync(`requests:${email}:insee`);
      // If already matched, skip
      if ((matchedEmail = await redis.getAsync(`requests:${email}:match`))) {
        await mailReminder(email, matchedEmail, insee);
        continue;
      }

      // Find someoneInTheQueue
      var someoneInTheQueue = await redis.lpopAsync(`offers:${insee}`);

      if (someoneInTheQueue) {
        await match(email, someoneInTheQueue, insee);
        continue;
      }

      if (!unmatchedRequestsByCommune[insee]) {
        unmatchedRequestsByCommune[insee] = [];
      }
      unmatchedRequestsByCommune[insee].push(email);
    }

    if (cursor == '0') {
      break;
    }
  }

  console.log('now handling yet unmatched requests...');
  // now handle unmatched requests
  for (let insee in unmatchedRequestsByCommune) {
    const emails = unmatchedRequestsByCommune[insee];
    await askMorePeople(insee, emails.length);
  }
}

/**
 * [match description]
 * @return {Promise}
 */
async function match(requestEmail, offerEmail, insee) {

  const requestConfirmLink = await generateRequestConfirmationLink(requestEmail);
  const cancelLink = await generateRequestCancelLink(requestEmail, offerEmail);

  // save to Redis
  await saveMatch(requestEmail, offerEmail);

  console.log(`${requestEmail} : matched to ${offerEmail}`);

  const commune = await getCityInformation(insee);
  const offer = await getOffer(offerEmail);

  var mailOptions = Object.assign({
    to: requestEmail, // list of receivers
    subject: 'Quelqu\'un peut prendre votre procuration !', // Subject line
    html: await request({
      url: config.mails.requestMatch,
      qs: {
        EMAIL: requestEmail,
        PHONE: offer.phone,
        FIRST_NAME: offer.first_name,
        COMMUNE: commune.completeName,
        LINK: requestConfirmLink,
        CANCEL_LINK: cancelLink,
      }
    })
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err) console.error(err.stack);
  });

  const offerConfirmLink = await generateOfferConfirmationLink(offerEmail);

  var address = `${offer.address1}<br>`;
  if (offer.address2) address += `${offer.address1}<br>`;
  address += `${offer.zipcode}<br>${commune.completeName}`;

  var mail2Options = Object.assign({
    to: offerEmail,
    subject: 'Quelqu\'un veut que vous preniez sa procuration !',
    html: await request({
      url: config.mails.offerMatch,
      qs: {
        EMAIL: offerEmail,
        FIRST_NAME: offer.first_name,
        LAST_NAME: offer.last_name,
        COMMUNE: commune.completeName,
        ADDRESS: address,
        BIRTH_DATE: offer.date,
        LINK: offerConfirmLink,
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
