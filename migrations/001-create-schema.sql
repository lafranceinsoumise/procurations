-- Up

CREATE TABLE admins (
  id INTEGER PRIMARY KEY,
  user TEXT UNIQUE,
  password TEXT,
  totp TEXT,
  totp_valid BOOLEAN
);

CREATE TABLE requests (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  token TEXT,
  validation DATETIME NULL,
  completion DATETIME NULL,
  insee TEXT NULL,
  changes INT DEFAULT 0,
  CONSTRAINT unique_email UNIQUE (email)
);

CREATE TABLE invitations (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  token TEXT,
  sent_date DATETIME
);

CREATE TABLE offers (
  id INTEGER PRIMARY KEY,
  insee TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  birth_date DATETIME,
  zipcode TEXT,
  address1 TEXT,
  address2 TEXT
  CONSTRAINT offer_fk_invitation_id FOREIGN KEY (id) REFERENCES invitations (id)
);

CREATE TABLE matches (
  request_id INTEGER UNIQUE,
  offer_id INTEGER UNIQUE,
  match_date DATETIME,
  offer_confirmation DATETIME NULL,
  offer_contirmation_token TEXT,
  offer_cancel_token TEXT NULL,
  request_confirmation DATETIME NULL,
  request_confirmation_token TEXT,
  request_cancel_token TEXT NULL,
  CONSTRAINT match_fk_request_id FOREIGN KEY (request_id) REFERENCES requests (id),
  CONSTRAINT match_fk_offer_id FOREIGN KEY (offer_id) REFERENCES offers (id)
);

CREATE TABLE cities (
  insee TEXT PRIMARY KEY,
  name TEXT,
  context TEXT,
  zipcodes TEXT
);

-- Down

DROP TABLE IF EXISTS admins
DROP TABLE IF EXISTS requests
DROP TABLE IF EXISTS invitations
DROP TABLE IF EXISTS offers
DROP TABLE IF EXISTS matches
DROP TABLE IF EXISTS cities;
