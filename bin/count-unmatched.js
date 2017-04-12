const stringify = require('csv-stringify');
const fs = require('fs');

const config = require('../config');
const redis = require('../lib/redis');

async function iterate() {
  console.log(`Starting match.js : ${(new Date()).toISOString()}`);
  console.log('new iteration of all requests');
  var cursor = 0;
  var emails;

  const unmatchedRequestsByCommune = {};

  // Iterate redis SCAN
  for (; ;) {
    [cursor, emails] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}requests:*:insee`, 'COUNT', '99');

    for (var i = 0; i < emails.length; i++) {
      var email = emails[i].match(`${config.redisPrefix}requests:(.*):insee`)[1];

      var insee = await redis.getAsync(`requests:${email}:insee`);

      // If already matched, skip
      if ((await redis.getAsync(`requests:${email}:match`))) {
        continue;
      }

      if (!unmatchedRequestsByCommune[insee]) {
        unmatchedRequestsByCommune[insee] = {
          nom: JSON.parse(await redis.getAsync(`commune:${insee}`)).completeName,
          count: 0
        };
      }
      unmatchedRequestsByCommune[insee].count += 1;
    }

    if (cursor === '0') {
      break;
    }
  }

  const out = fs.createWriteStream('unmatched.csv');

  const stringifier = stringify({
    delimiter: ',',
    columns: ['insee', 'nom', 'count'],
    header: true
  });

  stringifier.pipe(out);

  for (let insee in unmatchedRequestsByCommune) {
    stringifier.write({
      insee,
      nom: unmatchedRequestsByCommune[insee].nom,
      count: unmatchedRequestsByCommune[insee].count
    });
  }

  stringifier.end();
}

iterate()
  .then(() => {
    console.log('Finished!');
    redis.quit();
  })
  .catch((err) => console.log(err.stack));
