const httpRequest = require('request-promise-native');

const db = require('../lib/sqlite');
const config = require('../config');
const mailer = require('../lib/mailer');
const {saveMatch, getCityInformation} = require('../lib/actions');

const {askMorePeople, mailReminder} = require('./ask');


// Iterate people looking for offers
async function iterate() {
  console.log(`Starting match.js : ${(new Date()).toISOString()}`);
  console.log('new iteration of all requests');

  const unmatchedRequestsByCommune = {};

  var {count} = await db.get('SELECT COUNT(id) AS count FROM requests');
  // Iterate redis SCAN
  for(var i = 0; i < count; i+=100) {

    let results = await db.all('SELECT * FROM requests LEFT JOIN matches ON matches.request_id = requests.id WHERE insee IS NOT NULL LIMIT 100 OFFSET ?', i);

    for (var j = 0; i < results.length; i++) {
      let request = results[j];

      // If already matched, skip
      if (request.offer_id) {
        let offer = await db.get('SELECT * FROM offers WHERE offers.id = ?', request.offer_id);
        await mailReminder(request, offer);
        continue;
      }

      // Find offerInTheQueue
      let sql = 'SELECT offers.* FROM offers LEFT JOIN matches ON matches.offer_id = offers.id WHERE offers.insee = ? AND matches.request_id IS NULL';
      let offerInTheQueue = await db.get(sql, request.insee);

      if (offerInTheQueue) {
        await match(request, offerInTheQueue);
        continue;
      }

      // Add an unmatched request to the count for this commune
      if (!unmatchedRequestsByCommune[request.insee]) {
        unmatchedRequestsByCommune[request.insee] = 0;
      }
      unmatchedRequestsByCommune[request.insee]++;
    }
  }

  console.log('now handling yet unmatched requests...');
  // now handle unmatched requests
  for (let insee in unmatchedRequestsByCommune) {
    await askMorePeople(insee, unmatchedRequestsByCommune[insee]);
  }
}

/**
 * @param  {Object} request
 * @param  {Object} offer
 */
async function match(request, offer) {
  // save to Redis
  const {requestToken, offerToken, requestCancelToken} = await saveMatch(request, offer);
  console.log(`${request.email} : matched to ${offer.email}`);

  const city = await getCityInformation(request.insee);

  var mailOptions = Object.assign({
    to: request.email,
    subject: 'Quelqu\'un peut prendre votre procuration !', // Subject line
    html: await httpRequest({
      url: config.mails.requestMatch,
      qs: {
        EMAIL: request.email,
        PHONE: offer.phone,
        FIRST_NAME: offer.first_name,
        COMMUNE: city.name,
        LINK: `${config.host}/confirmation/${requestToken}`,
        CANCEL_LINK: `${config.host}/annulation/${requestCancelToken}`,
      }
    })
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err) console.error(err.stack);
  });

  var address = `${offer.address1}<br>`;
  if (offer.address2) address += `${offer.address1}<br>`;
  address += `${offer.zipcode}<br>${city.name}`;

  var mail2Options = Object.assign({
    to: offer.email,
    subject: 'Quelqu\'un veut que vous preniez sa procuration !',
    html: await httpRequest({
      url: config.mails.offerMatch,
      qs: {
        EMAIL: offer.email,
        FIRST_NAME: offer.first_name,
        LAST_NAME: offer.last_name,
        COMMUNE: city.name,
        ADDRESS: address,
        BIRTH_DATE: offer.birth_date,
        LINK: `${config.host}/mandataire/confirmation/${offerToken}`,
      },
    })
  }, config.emailOptions);

  mailer.sendMail(mail2Options, (err) => {
    if (err) console.error(err.stack);
  });
}

setTimeout(() => {
  iterate()
    .then(() => {
      console.log(`match.js finished  ==> ${(new Date()).toISOString()}`);
      console.log('----------------------------------------------');
    })
    .catch((err) => console.error(err.stack));
}, 1000);
