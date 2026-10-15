-- When Maddie last saw someone IN PERSON (texting doesn't count), for
-- "who haven't I seen in a while" suggestions.
ALTER TABLE IF EXISTS people ADD COLUMN IF NOT EXISTS last_seen_date DATE;
