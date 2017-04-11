const redis = require('../lib/redis');
const config = require('../config');

async function migrate() {
  // migrate cities information

  let cursor = 0;
  let keys;

  const cities = {};

  for(;;) {
    [cursor, keys] = redis.scan(cursor, 'MATCH', `${config.redisPrefix}requests:*:zipcodes`, 'COUNT', 99);

    for(let i = 0; i < keys.length; i++) {
      const email = keys[i].match(`^${config.redisPrefix}requests:(.*):zipcodes$`)[1];
      const [insee, zipcodes, completeName] = await redis.batch()
        .get(`requests:${email}:insee`)
        .get(`requests:${email}:zipcodes`)
        .get(`requests:${email}:commune`)
        .execAsync();

      if(zipcodes && completeName) {
        cities[insee] = {completeName, zipcodes};
      }
    }

    if (cursor === '0') {
      break;
    }
  }

  for (let insee in cities) {
    await redis.batch()
      .set(`commune:${insee}`, JSON.stringify({completeName: cities[insee].completeName}))
      .set(`code-postaux:${insee}`, cities[insee].zipcodes)
      .execAsync();
  }

}

migrate()
  .then(function() {
    console.log('Migration over.');
    redis.quit();
  })
  .catch(err => console.log(err.stack));
