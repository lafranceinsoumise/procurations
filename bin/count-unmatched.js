const stringify = require('csv-stringify');
const fs = require('fs');

const config = require('../config');
const redis = require('../lib/redis');

async function iterate() {
  const beforeInHours = +process.argv[2];
  const cutoffDate = Date.now() - beforeInHours * 3600 * 1000;

  console.log(`Starting match.js : ${(new Date()).toISOString()}`);
  console.log('new iteration of all requests');
  var cursor = 0;
  var emails;

  const people_out = fs.createWriteStream('unmatched_people.csv');
  const people_stringifier = stringify({
    delimiter: ',',
    columns: ['insee', 'nom_ville', 'email', 'date'],
    header: true
  });
  people_stringifier.pipe(people_out);

  const countUnmatchedByCommune = {};

  // Iterate redis SCAN
  for (; ;) {
    [cursor, emails] = await redis.scanAsync(cursor, 'MATCH', `${config.redisPrefix}requests:*:insee`, 'COUNT', '99');

    for (var i = 0; i < emails.length; i++) {
      var email = emails[i].match(`${config.redisPrefix}requests:(.*):insee`)[1];

      const [insee, valid, match] = await redis.batch()
          .get(`requests:${email}:insee`)
          .get(`requests:${email}:valid`)
          .get(`requests:${email}:match`)
          .execAsync();

      const nomVille = JSON.parse(await redis.getAsync(`commune:${insee}`)).completeName;

      // If already matched, skip
      if (match || valid === 'false') {
        continue;
      }

      const requestDate = new Date(valid);

      if(requestDate.getTime() > cutoffDate) {
        continue;
      }

      if (!countUnmatchedByCommune[insee]) {
        countUnmatchedByCommune[insee] = {
          nomVille,
          count: 0
        };
      }
      countUnmatchedByCommune[insee].count += 1;

      people_stringifier.write({insee, nom_ville: nomVille, email, date: requestDate.toISOString()});
    }

    if (cursor === '0') {
      break;
    }
  }

  const out = fs.createWriteStream('unmatched_count.csv');

  const stringifier = stringify({
    delimiter: ',',
    columns: ['insee', 'nom_ville', 'count'],
    header: true
  });

  stringifier.pipe(out);

  for (let insee in countUnmatchedByCommune) {
    stringifier.write({
      insee,
      nom_ville: countUnmatchedByCommune[insee].nomVille,
      count: countUnmatchedByCommune[insee].count
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
