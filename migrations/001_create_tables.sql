-- Create people table
CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    relationship TEXT CHECK (relationship IN ('friend', 'family', 'coworker', 'unknown')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create voice_entries table
CREATE TABLE IF NOT EXISTS voice_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recorded_at TIMESTAMPTZ NOT NULL,
    audio_path TEXT NOT NULL,
    transcript TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create person_updates table
CREATE TABLE IF NOT EXISTS person_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES people(id),
    voice_entry_id UUID NOT NULL REFERENCES voice_entries(id),
    update_text TEXT NOT NULL,
    context TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create daily_summaries table
CREATE TABLE IF NOT EXISTS daily_summaries (
    date DATE PRIMARY KEY,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_person_updates_person_id ON person_updates(person_id);
CREATE INDEX IF NOT EXISTS idx_person_updates_voice_entry_id ON person_updates(voice_entry_id);
CREATE INDEX IF NOT EXISTS idx_voice_entries_recorded_at ON voice_entries(recorded_at DESC);
