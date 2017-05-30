const uuid = require('uuid/v4');
const db = require('./sqlite');

/**
 * @param  {Object} requestId
 * @param  {Object} offerId
 * @return {Object} tokens
 *                  tokens.requestToken
 *                  tokens.offerToken
 */
async function saveMatch(request, offer) {
  var [requestToken, offerToken, requestCancelToken] = [uuid(), uuid(), uuid()];
  await db.run('INSERT INTO matches (\
    request_id,\
    offer_id,\
    match_date,\
    request_confirmation_token,\
    request_cancel_token,\
    offer_confirmation_token\
  ) VALUES (\
    ?,\
    ?,\
    ?,\
    ?,\
    ?,\
    ?\
  )', [
    request.id,
    offer.id,
    new Date(),
    requestToken,
    requestCancelToken,
    offerToken
  ]);

  return {requestToken, offerToken, requestCancelToken};
}

/**
 * @param  {Number} insee
 * @param  {object} city
 * @param           city.name
 * @param           city.context
 * @param           city.zipcodes
 */
async function saveCityInformation(insee, {name, context, zipcodes}) {
  await db.run('INSERT OR REPLACE INTO cities (insee, name, context, zipcodes)\
    VALUES (?, ?, ?, ?)', insee, name, context, JSON.stringify(zipcodes));
}

/**
 * @param  {Number} insee
 * @return {Object}
 */
async function getCityInformation(insee) {
  var city = await db.get('SELECT * FROM cities WHERE insee = ?', insee);
  if (!city) return;

  city.zipcodes = JSON.parse(city.zipcodes);

  return city;
}

module.exports = {
  saveMatch,
  getCityInformation,
  saveCityInformation
};
