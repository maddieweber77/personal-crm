-- Add tracking fields to people table
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS last_contact_date DATE,
  ADD COLUMN IF NOT EXISTS priority_level TEXT DEFAULT 'normal'; -- 'high', 'normal'

-- Friend events table (birthdays, weddings, trips, etc.)
CREATE TABLE IF NOT EXISTS friend_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'birthday', 'wedding', 'trip', 'interview', 'surgery', 'other'
  event_description TEXT NOT NULL,
  event_date DATE, -- Can be null for "sometime next month" type dates
  event_date_approximate TEXT, -- "next month", "in a few weeks", etc.
  is_recurring BOOLEAN DEFAULT FALSE, -- For birthdays
  reminder_sent_1week BOOLEAN DEFAULT FALSE,
  reminder_sent_1day BOOLEAN DEFAULT FALSE,
  reminder_sent_dayof BOOLEAN DEFAULT FALSE,
  source_entry_id UUID, -- Reference to voice_entry or manual_entry that mentioned this
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Friend situations table (breakups, life events requiring ongoing support)
CREATE TABLE IF NOT EXISTS friend_situations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  situation_type TEXT NOT NULL, -- 'breakup', 'sick_family', 'wedding_planning', 'new_job', 'tough_time', 'other'
  situation_description TEXT NOT NULL,
  severity TEXT DEFAULT 'medium', -- 'high', 'medium', 'low' - determines reminder frequency
  status TEXT DEFAULT 'active', -- 'active', 'resolved'
  started_at DATE NOT NULL,
  resolved_at DATE,
  last_reminder_sent TIMESTAMPTZ,
  source_entry_id UUID, -- Reference to voice_entry or manual_entry that mentioned this
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reminder log (track what reminders we've sent)
CREATE TABLE IF NOT EXISTS reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_type TEXT NOT NULL, -- 'event', 'situation', 'last_contact'
  person_id UUID REFERENCES people(id) ON DELETE CASCADE,
  related_event_id UUID REFERENCES friend_events(id) ON DELETE CASCADE,
  related_situation_id UUID REFERENCES friend_situations(id) ON DELETE CASCADE,
  message_sent TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_friend_events_date ON friend_events(event_date);
CREATE INDEX IF NOT EXISTS idx_friend_events_person ON friend_events(person_id);
CREATE INDEX IF NOT EXISTS idx_friend_situations_person ON friend_situations(person_id);
CREATE INDEX IF NOT EXISTS idx_friend_situations_status ON friend_situations(status);
CREATE INDEX IF NOT EXISTS idx_people_last_contact ON people(last_contact_date);
CREATE INDEX IF NOT EXISTS idx_people_priority ON people(priority_level);
