import { Pool } from 'pg';
import type {
  Person,
  VoiceEntry,
  PersonUpdate,
  DailySummary,
} from '../types';

// Lazy initialization: create pool on first use to ensure env vars are loaded
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    // Create pool on first access (ensures dotenv has loaded)
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    // Test the connection
    pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });

    console.log('✓ Database pool initialized');
  }
  return pool;
}

/**
 * Find a person by name or alias
 * Returns the first match found
 */
export async function findPersonByNameOrAlias(
  nameOrAlias: string
): Promise<Person | null> {
  const result = await getPool().query<Person>(
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
  const result = await getPool().query<Person>(
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
  const result = await getPool().query<VoiceEntry>(
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
  const result = await getPool().query<PersonUpdate>(
    `INSERT INTO person_updates (person_id, voice_entry_id, update_text, context)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [personId, voiceEntryId, updateText, context]
  );

  return result.rows[0];
}

/**
 * Get daily summary for a specific date
 * Returns null if no summary exists for that date
 */
export async function getDailySummary(
  date: string
): Promise<string | null> {
  const result = await getPool().query<DailySummary>(
    `SELECT summary FROM daily_summaries WHERE date = $1`,
    [date]
  );

  return result.rows[0]?.summary || null;
}

/**
 * Upsert daily summary (insert or update if date already exists)
 */
export async function upsertDailySummary(
  date: string,
  summary: string
): Promise<DailySummary> {
  const result = await getPool().query<DailySummary>(
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
 * Get all updates for a specific person by name
 */
export async function getPersonUpdates(personName: string): Promise<{
  person: Person;
  updates: PersonUpdate[];
} | null> {
  // Find the person
  const person = await findPersonByNameOrAlias(personName);
  if (!person) {
    return null;
  }

  // Get all their updates
  const result = await getPool().query<PersonUpdate>(
    `SELECT * FROM person_updates
     WHERE person_id = $1
     ORDER BY created_at DESC`,
    [person.id]
  );

  return {
    person,
    updates: result.rows,
  };
}

/**
 * Get all voice entries for a specific date
 */
export async function getVoiceEntriesByDate(date: string): Promise<VoiceEntry[]> {
  const result = await getPool().query<VoiceEntry>(
    `SELECT * FROM voice_entries
     WHERE DATE(recorded_at) = $1
     ORDER BY recorded_at ASC`,
    [date]
  );

  return result.rows;
}

/**
 * Get recent voice entries (last N days)
 */
export async function getRecentVoiceEntries(days: number = 7): Promise<VoiceEntry[]> {
  const result = await getPool().query<VoiceEntry>(
    `SELECT * FROM voice_entries
     WHERE recorded_at >= NOW() - INTERVAL '${days} days'
     ORDER BY recorded_at DESC`
  );

  return result.rows;
}

/**
 * Close the database pool (call this when shutting down the server)
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
  }
}
