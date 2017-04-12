const redis = require('../lib/redis');
const config = require('../config');

async function migrate() {
  // migrate cities information

  let cursor = 0;
  let keys;

  const cities = new Map();

  for(;;) {
    [cursor, keys] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}requests:*:zipcodes`, 'COUNT', 99);

    for(let i = 0; i < keys.length; i++) {
      const email = keys[i].match(`^${config.redisPrefix}requests:(.*):zipcodes$`)[1];
      const [insee, zipcodes, completeName] = await redis.batch()
        .get(`requests:${email}:insee`)
        .get(`requests:${email}:zipcodes`)
        .get(`requests:${email}:commune`)
        .execAsync();

      if(zipcodes && completeName && !cities.has(insee)) {
        cities.set(insee, {completeName, zipcodes});
      }
    }

    if (cursor === '0') {
      break;
    }
  }

  console.log(`found ${cities.size} different cities...`);
  console.log('now inserting...');

  for (let [insee, city] of cities) {
    await redis.batch()
      .set(`commune:${insee}`, JSON.stringify({completeName: city.completeName}))
      .set(`code-postaux:${insee}`, city.zipcodes)
      .execAsync();
  }

}

migrate()
  .then(function() {
    console.log('Migration over.');
    redis.quit();
  })
  .catch(err => console.log(err.stack));
