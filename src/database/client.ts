import { Pool } from 'pg';
import type {
  Person,
  VoiceEntry,
  PersonUpdate,
  DailySummary,
} from '../types';

// Create a connection pool (more efficient than creating new connections each time)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test the connection
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

/**
 * Find a person by name or alias
 * Returns the first match found
 */
export async function findPersonByNameOrAlias(
  nameOrAlias: string
): Promise<Person | null> {
  const result = await pool.query<Person>(
    `SELECT * FROM people
     WHERE LOWER(name) = LOWER($1)
     OR $1 = ANY(SELECT LOWER(unnest(aliases)))
     LIMIT 1`,
    [nameOrAlias]
  );

  return result.rows[0] || null;
}

/**
 * Create a new person
 */
export async function createPerson(
  name: string,
  aliases: string[],
  relationship: 'friend' | 'family' | 'coworker' | 'unknown'
): Promise<Person> {
  const result = await pool.query<Person>(
    `INSERT INTO people (name, aliases, relationship)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, aliases, relationship]
  );

  return result.rows[0];
}

/**
 * Create a new voice entry
 */
export async function createVoiceEntry(
  recordedAt: Date,
  audioPath: string,
  transcript: string
): Promise<VoiceEntry> {
  const result = await pool.query<VoiceEntry>(
    `INSERT INTO voice_entries (recorded_at, audio_path, transcript)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [recordedAt, audioPath, transcript]
  );

  return result.rows[0];
}

/**
 * Create a new person update
 */
export async function createPersonUpdate(
  personId: string,
  voiceEntryId: string,
  updateText: string,
  context: string | null
): Promise<PersonUpdate> {
  const result = await pool.query<PersonUpdate>(
    `INSERT INTO person_updates (person_id, voice_entry_id, update_text, context)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [personId, voiceEntryId, updateText, context]
  );

  return result.rows[0];
}

/**
 * Upsert daily summary (insert or update if date already exists)
 */
export async function upsertDailySummary(
  date: string,
  summary: string
): Promise<DailySummary> {
  const result = await pool.query<DailySummary>(
    `INSERT INTO daily_summaries (date, summary)
     VALUES ($1, $2)
     ON CONFLICT (date)
     DO UPDATE SET summary = EXCLUDED.summary
     RETURNING *`,
    [date, summary]
  );

  return result.rows[0];
}

/**
 * Close the database pool (call this when shutting down the server)
 */
export async function closePool(): Promise<void> {
  await pool.end();
}
