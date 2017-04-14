const redis = require('../lib/redis');
const config = require('../config');

async function correct() {
  // migrate cities information

  let cursor = 0;
  let keys;
  let correctedTimestamp = (new Date('2017-04-12 20:00:00')).getTime();

  let wrongDate = 'Thu Apr 13 2017 09:02:16 GMT+0000 (UTC)';

  process.stdout.write('Modified 0');
  let k = 0;

  for (;;) {
    [cursor, keys] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}requests:*:date`);

    for(let i = 0; i < keys.length; i++) {
      const email = keys[i].match(`${config.redisPrefix}requests:(.*):date`)[1];

      const date = await redis.getAsync(`requests:${email}:date`);

      if (date === wrongDate) {
        await redis.setAsync(`requests:${email}:date`, correctedTimestamp);
        process.stdout.write(`\rModified ${++k}`);
      }
    }

    if(cursor === '0') {
      break;
    }

  }
  process.stdout.write('\n');

}

correct()
  .then(() => {
    console.log('Finished!');
    redis.quit();
  })
  .catch((err) => console.log(err.stack));
