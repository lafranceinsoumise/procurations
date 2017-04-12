const redis = require('../lib/redis');
const config = require('../config');

async function migrate() {
  // migrate cities information

  let cursor = 0;
  let keys;
  let today = Date.now();

  console.log('starting');

  const cities = new Map();

  let k = 0;

  for(;;) {
    [cursor, keys] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}requests:*:zipcodes`, 'COUNT', 99);

    for(let i = 0; i < keys.length; i++) {
      process.stdout.write(`\r${++k}`);

      const email = keys[i].match(`^${config.redisPrefix}requests:(.*):zipcodes$`)[1];
      const [insee, zipcodes, completeName, requestDate] = await redis.batch()
        .get(`requests:${email}:insee`)
        .get(`requests:${email}:zipcodes`)
        .get(`requests:${email}:commune`)
        .get(`requests:${email}:date`)
        .execAsync();

      if(zipcodes && completeName && !cities.has(insee)) {
        cities.set(insee, {completeName, zipcodes});
      }

      // add today date for requests so that we can identify procuration age
      if(!requestDate) {
        await redis.setAsync(`requests:${email}:date`, today);
      }
    }

    if (cursor === '0') {
      break;
    }
  }

  process.stdout.write('\n');
  console.log(`found ${cities.size} different cities...`);
  console.log('now inserting cities...');

  process.stdout.write('Inserted 0 cities');
  let i = 0;
  for (let [insee, city] of cities) {
    if (!await redis.getAsync(`commune:${insee}`)) {
      process.stdout.write(`\rInserted ${++i} cities`);
      await redis.batch()
        .set(`commune:${insee}`, JSON.stringify({completeName: city.completeName}))
        .set(`code-postaux:${insee}`, city.zipcodes)
        .execAsync();
    }
  }
  process.stdout.write('\n');
}

migrate()
  .then(function() {
    console.log('Migration over.');
    redis.quit();
  })
  .catch(err => console.log(err.stack));
