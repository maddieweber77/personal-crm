import { Pool } from 'pg';
import type {
  Person,
  VoiceEntry,
  PersonUpdate,
  DailySummary,
  ManualEntry,
  FriendEvent,
  FriendSituation,
  ReminderLog,
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
 * Create a manual entry (screenshot or text message)
 */
export async function createManualEntry(
  entryType: 'text' | 'image',
  messageText: string | null,
  imageUrl: string | null,
  imageAnalysis: string | null,
  extractedContent: string
): Promise<ManualEntry> {
  const result = await getPool().query<ManualEntry>(
    `INSERT INTO manual_entries (entry_type, message_text, image_url, image_analysis, extracted_content)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [entryType, messageText, imageUrl, imageAnalysis, extractedContent]
  );

  return result.rows[0];
}

/**
 * Get recent manual entries
 */
export async function getRecentManualEntries(days: number = 7): Promise<ManualEntry[]> {
  const result = await getPool().query<ManualEntry>(
    `SELECT * FROM manual_entries
     WHERE created_at >= NOW() - INTERVAL '${days} days'
     ORDER BY created_at DESC`
  );

  return result.rows;
}

/**
 * Search manual entries for mentions of a person name
 * Returns entries where the extracted_content mentions the name
 */
export async function searchManualEntriesByName(name: string): Promise<ManualEntry[]> {
  const result = await getPool().query<ManualEntry>(
    `SELECT * FROM manual_entries
     WHERE LOWER(extracted_content) LIKE LOWER($1)
        OR LOWER(message_text) LIKE LOWER($1)
     ORDER BY created_at DESC`,
    [`%${name}%`]
  );

  return result.rows;
}

/**
 * Update last contact date for a person
 */
export async function updateLastContactDate(
  personId: string,
  contactDate: Date
): Promise<void> {
  await getPool().query(
    `UPDATE people
     SET last_contact_date = $1, updated_at = NOW()
     WHERE id = $2`,
    [contactDate, personId]
  );
}

/**
 * Create a friend event (birthday, wedding, etc.)
 */
export async function createFriendEvent(
  personId: string,
  eventType: 'birthday' | 'wedding' | 'trip' | 'interview' | 'surgery' | 'other',
  eventDescription: string,
  eventDate: Date | null,
  eventDateApproximate: string | null,
  isRecurring: boolean,
  sourceEntryId: string | null
): Promise<FriendEvent> {
  const result = await getPool().query<FriendEvent>(
    `INSERT INTO friend_events (person_id, event_type, event_description, event_date, event_date_approximate, is_recurring, source_entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [personId, eventType, eventDescription, eventDate, eventDateApproximate, isRecurring, sourceEntryId]
  );

  return result.rows[0];
}

/**
 * Create a friend situation (breakup, sick family, etc.)
 */
export async function createFriendSituation(
  personId: string,
  situationType: 'breakup' | 'sick_family' | 'wedding_planning' | 'new_job' | 'tough_time' | 'other',
  situationDescription: string,
  severity: 'high' | 'medium' | 'low',
  startedAt: Date,
  sourceEntryId: string | null
): Promise<FriendSituation> {
  const result = await getPool().query<FriendSituation>(
    `INSERT INTO friend_situations (person_id, situation_type, situation_description, severity, started_at, source_entry_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [personId, situationType, situationDescription, severity, startedAt, sourceEntryId]
  );

  return result.rows[0];
}

/**
 * Get upcoming events (within next N days)
 */
export async function getUpcomingEvents(days: number = 30): Promise<Array<FriendEvent & { name: string; relationship: string }>> {
  const result = await getPool().query(
    `SELECT fe.*, p.name, p.relationship
     FROM friend_events fe
     JOIN people p ON fe.person_id = p.id
     WHERE fe.event_date IS NOT NULL
       AND fe.event_date >= CURRENT_DATE
       AND fe.event_date <= CURRENT_DATE + INTERVAL '${days} days'
     ORDER BY fe.event_date ASC`
  );

  return result.rows;
}

/**
 * Get active situations that need follow-up
 */
export async function getActiveSituations(): Promise<Array<FriendSituation & { name: string; relationship: string }>> {
  const result = await getPool().query(
    `SELECT fs.*, p.name, p.relationship
     FROM friend_situations fs
     JOIN people p ON fs.person_id = p.id
     WHERE fs.status = 'active'
     ORDER BY fs.severity DESC, fs.started_at ASC`
  );

  return result.rows;
}

/**
 * Get people who haven't been contacted recently
 * @param priorityDays - Days threshold for high priority friends (default 14)
 * @param normalDays - Days threshold for normal priority friends (default 28)
 */
export async function getPeopleNeedingContact(
  priorityDays: number = 14,
  normalDays: number = 28
): Promise<Person[]> {
  const result = await getPool().query<Person>(
    `SELECT *
     FROM people
     WHERE (
       (priority_level = 'high' AND (last_contact_date IS NULL OR last_contact_date < CURRENT_DATE - INTERVAL '${priorityDays} days'))
       OR
       (priority_level = 'normal' AND (last_contact_date IS NULL OR last_contact_date < CURRENT_DATE - INTERVAL '${normalDays} days'))
     )
     ORDER BY priority_level DESC, last_contact_date ASC NULLS FIRST`
  );

  return result.rows;
}

/**
 * Log a reminder that was sent
 */
export async function logReminder(
  reminderType: 'event' | 'situation' | 'last_contact',
  personId: string | null,
  relatedEventId: string | null,
  relatedSituationId: string | null,
  messageSent: string
): Promise<ReminderLog> {
  const result = await getPool().query<ReminderLog>(
    `INSERT INTO reminder_log (reminder_type, person_id, related_event_id, related_situation_id, message_sent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [reminderType, personId, relatedEventId, relatedSituationId, messageSent]
  );

  return result.rows[0];
}

/**
 * Mark event reminder as sent
 */
export async function markEventReminderSent(
  eventId: string,
  reminderType: '1week' | '1day' | 'dayof'
): Promise<void> {
  const column = reminderType === '1week' ? 'reminder_sent_1week' :
                 reminderType === '1day' ? 'reminder_sent_1day' :
                 'reminder_sent_dayof';

  await getPool().query(
    `UPDATE friend_events
     SET ${column} = TRUE, updated_at = NOW()
     WHERE id = $1`,
    [eventId]
  );
}

/**
 * Update situation last reminder sent timestamp
 */
export async function updateSituationReminderSent(situationId: string): Promise<void> {
  await getPool().query(
    `UPDATE friend_situations
     SET last_reminder_sent = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [situationId]
  );
}

/**
 * Get all events for a specific person
 */
export async function getPersonEvents(personId: string): Promise<FriendEvent[]> {
  const result = await getPool().query<FriendEvent>(
    `SELECT * FROM friend_events
     WHERE person_id = $1
     ORDER BY event_date ASC NULLS LAST, created_at DESC`,
    [personId]
  );

  return result.rows;
}

/**
 * Get all situations for a specific person
 */
export async function getPersonSituations(personId: string): Promise<FriendSituation[]> {
  const result = await getPool().query<FriendSituation>(
    `SELECT * FROM friend_situations
     WHERE person_id = $1
     ORDER BY status ASC, started_at DESC`,
    [personId]
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
