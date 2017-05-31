const base64 = require('js-base64').Base64;
const httpRequest = require('request-promise-native');
const sortBy = require('lodash/sortBy');
const uuid = require('uuid/v4');

const {getCityInformation} = require('../lib/actions');
const config = require('../config');
const db = require('../lib/sqlite');
const mailer = require('../lib/mailer');

/**
 * Ask ten more people we did not ask
 * @param  {string}  insee
 * @param  {int} count
 * @return {Promise}
 */
async function askMorePeople(insee, count) {
  const city = await getCityInformation(insee);

  const today = new Date();
  const people = [];
  const alreadyContacted = [];
  // Iterate API pages to find 10 people with no pending invitation
  for (var page = 1; people.length < 10; page++) {
    let peoplePage;
    try {
      peoplePage = await getPeoplePage(city.zipcodes, page);
      if (peoplePage.length === 0) break;
    } catch (err) {
      return console.error('Can\'t get people from api.jlm2017.fr\n', err.stack);
    }

    for (var i = 0; i < peoplePage.length && people.length < 10 * count; i++) {
      if (peoplePage[i].bounced) continue;

      const [request, offer, invitation] = await Promise.all([
        db.get('SELECT * FROM requests WHERE email = ?', peoplePage[i].email.toLowerCase()),
        db.get('SELECT * FROM offers WHERE email = ? AND insee IS NOT NULL', peoplePage[i].email.toLowerCase()),
        db.get('SELECT * FROM offers WHERE email = ? AND insee IS NULL', peoplePage[i].email.toLowerCase()),
      ]);

      // on n'inclut pas les gens qui veulent donner leur procuration ou qui ont
      // déjà proposé d'en prendre une
      if (request || offer) {
        continue;
      }

      // on traite séparément les gens qui ont déjà reçu une invitation
      if (invitation) {
        let lastDate = new Date(invitation.sent_date);

        if (dateDiffInDays(today, lastDate) >= config.recontactAfterDays) {
          alreadyContacted.push([lastDate.getTime(), peoplePage[i]]);
        }

        continue;
      }

      people.push(peoplePage[i]);
    }
  }

  if (people.length < 5 * count) {
    const sortedPeople = sortBy(alreadyContacted, a => a[0]);

    for (let i= 0; i < sortedPeople.length && people.length < 5 * count; i++) {
      people.push(sortedPeople[i][1]);
    }
  }

  await Promise.all(people.map(person => askSomeone(person, count, city)));
  console.log(`${city.zipcodes} : asked ${people.length} more people`);
}

/**
 * Get a page of https://api.jlm2017.fr/people endpoint with filter on zipcode
 * @param  {Array}  zipcodes  Searched zipcodes
 * @param  {Number}  [page=0] Page number
 * @return {Promise}          Promise on array of {email, zipcode}
 */
async function getPeoplePage(zipcodes, page = 0) {
  var people = await httpRequest({
    url: `https://api.jlm2017.fr/people?where={"location.zip":{"$in":${JSON.stringify(zipcodes)}},"_created":{"$lt":"Sun, 26 Mar 2017 23:59:59 GMT"}}&page=${page}`,
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

async function askSomeone(person, count) {
  var token = uuid();
  var emailContent = await httpRequest({
    url: config.mails.invitation,
    qs: {
      EMAIL: person.email,
      COUNT: count,
      LINK: `${config.host}/mandataire/${token}`
    }
  });

  await db.run('INSERT OR REPLACE INTO offers (email, token, invitation_date) VALUES (?, ?, ?)',
    person.email.toLowerCase(), token, new Date()
  );

  var mailOptions = Object.assign({
    to: person.email, // list of receivers
    subject: `${count} insoumis.e${count > 1 ? 's cherchent' : ' cherche'} une procuration près de chez vous !`, // Subject line
    html: emailContent // html body
  }, config.emailOptions);

  mailer.sendMail(mailOptions, (err) => {
    if (err) console.error(err.stack);
  });
}

function dateDiffInDays(a, b) {
  // Discard the time and time-zone information.
  var utc2 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  var utc1 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());

  return Math.floor((utc2 - utc1) /1000/3600/24);
}

async function mailReminder(request, offer, insee) {
  return; // TODO re-enable this
  /*
   * Send regular mail reminders to both offerer and requester
   */
  var date =  new Date(await redis.getAsync(`requests:${requestEmail}:matchDate`));
  var now = new Date();

  const dateDiff = dateDiffInDays(now, date);

  var commune = JSON.parse(await redis.getAsync(`commune:${insee}`));
  var offer = JSON.parse(await redis.getAsync(`offers:${offerEmail}`));

  var posted = await redis.getAsync(`requests:${requestEmail}:posted`);
  const requestConfirmed = posted & constants.requestHasConfirm;
  const offerConfirmed = posted & constants.offerHasConfirm;

  // ce mail est envoyé si le mandataire n'a pas indiqué avoir été contacté, trois jours après
  // le match
  if (!offerConfirmed && dateDiff >= 3 && ! await redis.getAsync(`reminder:contact:${requestEmail}`)) {
    const mailOptions = Object.assign({
      to: requestEmail, // list of receivers
      subject: 'N\'oubliez pas de prendre contact avec votre mandataire !', // Subject line
      html: await request({
        url: config.mails.requestContactReminder,
        qs: {
          EMAIL: offerEmail,
          PHONE: offer.phone,
          FIRST_NAME: offer.first_name,
          COMMUNE: commune.completeName
        }
      })
    }, config.emailOptions);
    mailer.sendMail(mailOptions, async (err) => {
      if (err) console.error(err.stack);
      await redis.setAsync(`reminder:contact:${requestEmail}`, 1);
    });
  }

  // ce mail est envoyé si le mandataire a indiqué avoir été contacté,
  // mais que le mandant n'a pas confirmé avoir fait la procuration, dès 4 jours
  // après le match
  if(offerConfirmed && !requestConfirmed && dateDiff >= 5 && !await redis.getAsync(`reminder:procuration:${requestEmail}`)) {
    const offer = JSON.parse(await redis.getAsync(`offers:${offerEmail}`));

    var address = `${offer.address1}<br>`;
    if (offer.address2) address += `${offer.address1}<br>`;
    address += `${offer.zipcode}<br>${'name' in commune ? commune.name : commune.completeName}`;

    const requestConfirmationLink = await generateRequestConfirmationLink(requestEmail);
    const requestCancelLink = await generateRequestCancelLink(requestEmail, offerEmail);

    const mailOptions = Object.assign({
      to: requestEmail,
      subject: 'Avez vous bien fait votre procuration ?',
      html: await httpRequest({
        url: config.mails.requestProcurationReminder,
        qs: {
          EMAIL: requestEmail,
          FIRST_NAME: offer.first_name,
          LAST_NAME: offer.last_name,
          COMMUNE: commune.completeName,
          ADDRESS: address,
          BIRTH_DATE: offer.date,
          LINK: requestConfirmationLink,
          CANCEL_LINK: requestCancelLink
        }
      })
    }, config.emailOptions);

    mailer.sendMail(mailOptions, async (err) => {
      if (err) console.error(err.stack);
      await redis.setAsync(`reminder:procuration:${requestEmail}`, 1);
    });
  }

  // ce mail est envoyé au mandataire si le mandant n'est pas très réactif,
  // pour lui proposer de prendre la procuration de quelqu'un d'autre, histoire
  // de libérer des mandataires
  if(!offerConfirmed && !requestConfirmed && dateDiff >= 6 && !await redis.getAsync(`reminder:mandataire:${offerEmail}`)) {
    const offerConfirmationLink = await generateOfferConfirmationLink(offerEmail);
    const offerCancelLink = await generateOfferCancelLink(requestEmail, offerEmail);

    const mailOptions = Object.assign({
      to: offerEmail,
      subject: 'Y a-t-il un problème avec cette procuration ?',
      html: await request({
        url: config.mails.offerNoOfferConfirmationReminder,
        qs: {
          EMAIL: offerEmail,
          FIRST_NAME: offer.first_name,
          COMMUNE: commune.completeName,
          LINK: offerConfirmationLink,
          CANCEL_LINK: offerCancelLink
        }
      })
    }, config.emailOptions);

    mailer.sendMail(mailOptions, async (err) => {
      if (err) console.error(err.stack);
      await redis.setAsync(`reminder:mandataire:${offerEmail}`, 1);
    });
  }
}

module.exports = {askMorePeople, mailReminder};
