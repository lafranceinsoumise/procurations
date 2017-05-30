-- Up
DROP TABLE `offers`;
DROP table `invitations`;
CREATE TABLE offers (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  token TEXT,
  invitation_date DATETIME,
  insee TEXT NULL,
  first_name TEXT NULL,
  last_name TEXT NULL,
  phone TEXT NULL,
  birth_date DATETIME NULL,
  zipcode TEXT NULL,
  address1 TEXT NULL,
  address2 TEXT NULL
);

DROP TABLE `matches`;
CREATE TABLE matches (
  request_id INTEGER UNIQUE,
  offer_id INTEGER UNIQUE,
  match_date DATETIME,
  offer_confirmation DATETIME NULL,
  offer_confirmation_token TEXT,
  offer_cancel_token TEXT NULL,
  request_confirmation DATETIME NULL,
  request_confirmation_token TEXT,
  request_cancel_token TEXT NULL,
  CONSTRAINT match_fk_request_id FOREIGN KEY (request_id) REFERENCES requests (id),
  CONSTRAINT match_fk_offer_id FOREIGN KEY (offer_id) REFERENCES offers (id)
);

-- Down

DROP TABLE `matches`;
CREATE TABLE matches (
  request_id INTEGER UNIQUE,
  offer_id INTEGER UNIQUE,
  match_date DATETIME,
  offer_confirmation DATETIME NULL,
  offer_confirmation_token TEXT,
  offer_cancel_token TEXT NULL,
  request_confirmation DATETIME NULL,
  request_confirmation_token TEXT,
  request_cancel_token TEXT NULL,
  CONSTRAINT match_fk_request_id FOREIGN KEY (request_id) REFERENCES requests (id),
  CONSTRAINT match_fk_offer_id FOREIGN KEY (offer_id) REFERENCES offers (id)
);

DROP TABLE `offers`;
CREATE TABLE offers (
  id INTEGER PRIMARY KEY,
  insee TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  birth_date DATETIME,
  zipcode TEXT,
  address1 TEXT,
  address2 TEXT,
  CONSTRAINT offer_fk_invitation_id FOREIGN KEY (id) REFERENCES invitations (id)
);

CREATE TABLE invitations (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  token TEXT,
  sent_date DATETIME
);
