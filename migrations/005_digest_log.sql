-- One row per digest sent (e.g. the 'morning' digest for 2026-10-14).
-- The primary key is how the app makes sure a digest is only sent once a day,
-- even if the server restarts or runs twice: it INSERTs the row first
-- ("claims" the day) and only sends if that INSERT actually added a row.
CREATE TABLE IF NOT EXISTS digest_log (
  digest_date DATE NOT NULL,
  digest_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sms_ok BOOLEAN, -- NULL until the send finished
  email_ok BOOLEAN,
  PRIMARY KEY (digest_date, digest_type)
);
