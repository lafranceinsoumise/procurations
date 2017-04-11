const bluebird = require('bluebird');
const redisPkg = require('redis');

const config = require('../config');

bluebird.promisifyAll(redisPkg.RedisClient.prototype);
bluebird.promisifyAll(redisPkg.Multi.prototype);

const redis = redisPkg.createClient({prefix: config.redisPrefix});

module.exports = redis;
