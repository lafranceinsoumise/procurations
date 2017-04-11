const uuid = require('uuid/v4');

const redis = require('./redis');
const config = require('../config');

async function generateRequestConfirmationLink(requestEmail) {
  const token = uuid();
  await redis.setAsync(`requests:confirmations:${token}`, requestEmail);
  return `${config.host}/confirmation/${token}`;
}

async function generateOfferConfirmationLink(offerEmail) {
  const token = uuid();
  await redis.setAsync(`offers:confirmations:${token}`, offerEmail);
  return `${config.host}/procuration/confirmation/${token}`;
}

async function generateInvitationLink(invitationEmail) {
  const token = uuid();
  await redis.setAsync(`invitations:${token}`, invitationEmail);
  return  `${config.host}/procuration/${token}`;
}

async function generateRequestCancelLink(requestEmail, offerEmail) {
  const cancelToken = uuid();

  await redis.setAsync(`requests:cancel:${cancelToken}`, JSON.stringify({requestEmail, offerEmail}));

  return `${config.host}/annulation/${cancelToken}`;
}

async function generateOfferCancelLink(requestEmail, offerEmail) {
  const cancelToken = uuid();

  await redis.setAsync(`offers:cancel:${cancelToken}`, JSON.stringify({requestEmail, offerEmail}));

  return `${config.host}/procuration/annulation/${cancelToken}`;
}

async function checkCancelToken(path) {
  let requestEmail, offerEmail;

  ({requestEmail, offerEmail} = JSON.parse(
      await redis.getAsync(path)
  ));

  const [storedRequestEmail, storedOfferEmail] = await redis.batch()
    .get(`offers:${offerEmail}:match`)
    .get(`requests:${requestEmail}:match`)
    .execAsync();

  if ((storedRequestEmail !== requestEmail) || (storedOfferEmail !== offerEmail)) {
    throw new Error('different mails');
  }

  return [requestEmail, offerEmail];
}

async function checkRequestCancelToken(token) {
  return await checkCancelToken(`requests:cancel:${token}`);
}

async function checkOfferCancelToken(token) {
  return await checkCancelToken(`offers:cancel:${token}`);
}

module.exports = {
  generateRequestConfirmationLink,
  generateOfferConfirmationLink,
  generateRequestCancelLink,
  generateOfferCancelLink,
  checkRequestCancelToken,
  checkOfferCancelToken,
  generateInvitationLink
};
