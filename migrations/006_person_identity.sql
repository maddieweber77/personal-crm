-- Who-is-who: give people stable identifiers and stop guessing on unclear names.

-- Phone numbers (E.164, e.g. +17045551234) from Contacts: one number = one person.
ALTER TABLE IF EXISTS people ADD COLUMN IF NOT EXISTS phone_numbers TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS people ADD COLUMN IF NOT EXISTS birthday DATE;
-- A merged duplicate points at the person it was merged into (kept, not deleted).
ALTER TABLE IF EXISTS people ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES people(id);
CREATE INDEX IF NOT EXISTS idx_people_phone_numbers ON people USING GIN (phone_numbers);

-- Updates can come from a text/screenshot too, not only a phone call.
-- (Before this, updates from texts failed: voice_entry_id had to be a call.)
ALTER TABLE IF EXISTS person_updates ALTER COLUMN voice_entry_id DROP NOT NULL;
ALTER TABLE IF EXISTS person_updates ADD COLUMN IF NOT EXISTS manual_entry_id UUID REFERENCES manual_entries(id);

-- Mentions the AI couldn't pin to one person ("Sarah" when there are two).
-- The extracted details wait here until Maddie says who it was.
CREATE TABLE IF NOT EXISTS pending_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mention TEXT NOT NULL,
  candidate_ids UUID[] NOT NULL DEFAULT '{}',
  extracted JSONB NOT NULL,
  source_kind TEXT NOT NULL, -- 'voice' | 'manual'
  source_entry_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'resolved' | 'dismissed'
  resolved_person_id UUID REFERENCES people(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pending_mentions_status ON pending_mentions(status);
