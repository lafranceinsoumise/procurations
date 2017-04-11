const redis = require('./redis');


async function saveMatch(requestEmail, offerEmail) {
  await redis.batch()
    .set(`requests:${requestEmail}:match`, offerEmail)
    .set(`requests:${requestEmail}:matchDate`, new Date())
    .set(`offers:${offerEmail}:match`, requestEmail)
    .execAsync();
}

async function cancelMatch(requestEmail, offerEmail) {
  const insee = await redis.getAsync(`requests:${requestEmail}:insee`);
  await redis.batch()
    .del(`requests:${requestEmail}:match`)
    .del(`requests:${requestEmail}:matchDate`)
    .del(`requests:${requestEmail}:posted`)
    .del(`offers:${offerEmail}:match`)
    .rpush(`offers:${insee}`, offerEmail)
    .execAsync();
}

async function saveOffer(offerEmail, offer) {
  await redis.setAsync(`offers:${offerEmail}`, JSON.stringify(offer));
}

async function getOffer(offerEmail) {
  return JSON.parse(await redis.getAsync(`offers:${offerEmail}`));
}

async function saveCityInformation(insee, {name, context, zipcodes}) {
  const completeName = `${name} (${context})`;
  await redis.batch()
    .set(`commune:${insee}`, JSON.stringify({name, context, completeName}))
    .set(`code-postaux:${insee}`, JSON.stringify(zipcodes))
    .execAsync();
}

async function getCityInformation(insee) {
  return JSON.parse(await redis.getAsync(`commune:${insee}`));
}

module.exports = {
  saveMatch,
  cancelMatch,
  saveOffer,
  getOffer,
  getCityInformation,
  saveCityInformation
};
