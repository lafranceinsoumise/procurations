const nodemailer = require('nodemailer');

const config = require('../config');

const mailer = nodemailer.createTransport(config.emailTransport);

module.exports = mailer;
