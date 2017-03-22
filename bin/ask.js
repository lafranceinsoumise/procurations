const base64 = require('js-base64').Base64;
const request = require('request-promise-native');
const uuid = require('uuid/v4');

const config = require('../config');
var {redis, mailer} = require('./match');

/**
 * Ask ten more people we did not ask
 * @param  {Array}  zipcodes
 * @return {Promise}
 */
async function askTenMorePeople(zipcodes) {
  var people = [];
  // Iterate API pages to find 10 people with no pending invitation
  for (var page = 0; people.length < 10; page++) {
    let peoplePage;
    try {
      peoplePage = await getPeoplePage(zipcodes, page);
      if (peoplePage.length == 0) break;
    } catch (err) {
      return console.error('Can\'t get people from NationBuilder', err.stack);
    }

    for (var i = 0; i < peoplePage.length && people.length < 10; i++) {
      if (await redis.getAsync(`invitations:${peoplePage[i].email}:date`)) continue;
      people.push(peoplePage[i]);
    }
  }

  await Promise.all(people.map(askSomeone));
  console.log(`${zipcodes} : asked ${people.length} more people`);
}

/**
 * Get a page of https://api.jlm2017.fr/people endpoint with filter on zipcode
 * @param  {Array}  zipcodes  Searched zipcodes
 * @param  {Number}  [page=0] Page number
 * @return {Promise}          Promise on array of {email, zipcode}
 */
async function getPeoplePage(zipcodes, page = 0) {
  var people = await request({
    url: `https://api.jlm2017.fr/people?where={"location.zip":{"$in":${zipcodes}}}&page=${page}`,
    headers: {
      Authorization: `Basic ${base64.encode(`${config.api_key}:`)}`
    },
    json: true
  });

  return people._items.filter(person => person.email_opt_in).map(person => ({
    email: person.email,
    zipcode: person.location.zip
  }));
}

async function askSomeone(person) {
  var token = uuid();
  var emailContent = await request({
    url: config.mails.invitation,
    qs: {
      EMAIL: person.email,
      LINK: `${config.host}/procuration/${token}`
    }
  });

  await redis.lpushAsync('invitations:all', person.email);
  await redis.setAsync(`invitations:${token}`, person.email);
  await redis.setAsync(`invitations:${person.email}:date`, new Date());

  var mailOptions = Object.assign({
    to: person.email, // list of receivers
    subject: 'Quelqu\'un près de chez vous a besoin d\'une procuration !', // Subject line
    html: emailContent // html body
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err) console.error(err.stack);
  });
}

module.exports = askTenMorePeople;
