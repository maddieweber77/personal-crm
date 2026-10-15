import { Pool } from 'pg';
import { planMerge, type MergeablePerson } from '../services/merge-plan';
import type { RosterPerson } from '../services/person-resolver';
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
  // Both sides lowercased (aliases used to be compared against the raw name,
  // so "Gracie" never matched the alias "gracie"). Merged duplicates are skipped.
  const result = await getPool().query<Person>(
    `SELECT * FROM people
     WHERE merged_into_id IS NULL
       AND (LOWER(name) = LOWER($1)
            OR LOWER($1) = ANY(SELECT LOWER(unnest(aliases))))
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

/** Where an update came from: a phone call or a texted note (exactly one is set). */
export interface UpdateSource {
  voiceEntryId: string | null;
  manualEntryId: string | null;
}

/**
 * Create a new person update
 */
export async function createPersonUpdate(
  personId: string,
  source: UpdateSource,
  updateText: string,
  context: string | null
): Promise<PersonUpdate> {
  const result = await getPool().query<PersonUpdate>(
    `INSERT INTO person_updates (person_id, voice_entry_id, manual_entry_id, update_text, context)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [personId, source.voiceEntryId, source.manualEntryId, updateText, context]
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
 * Day counts can come from LLM output, so never trust them as SQL text:
 * coerce to a whole number in 0..3650 (fallback if it isn't a number).
 */
export function toDayCount(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), 3650);
}

/**
 * Get recent voice entries (last N days)
 */
export async function getRecentVoiceEntries(days: number = 7): Promise<VoiceEntry[]> {
  const result = await getPool().query<VoiceEntry>(
    `SELECT * FROM voice_entries
     WHERE recorded_at >= NOW() - make_interval(days => $1)
     ORDER BY recorded_at DESC`,
    [toDayCount(days, 7)]
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
     WHERE created_at >= NOW() - make_interval(days => $1)
     ORDER BY created_at DESC`,
    [toDayCount(days, 7)]
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
  // Calendar date in New York (a 9pm call is still "today", not tomorrow in UTC),
  // and never move it backwards when an older note is processed late.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(contactDate);
  await getPool().query(
    `UPDATE people
     SET last_contact_date = GREATEST(last_contact_date, $1::date), updated_at = NOW()
     WHERE id = $2`,
    [day, personId]
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
       AND fe.event_date <= CURRENT_DATE + make_interval(days => $1)
     ORDER BY fe.event_date ASC`,
    [toDayCount(days, 30)]
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
     WHERE merged_into_id IS NULL AND (
       (priority_level = 'high' AND (last_contact_date IS NULL OR last_contact_date < CURRENT_DATE - make_interval(days => $1)))
       OR
       (priority_level = 'normal' AND (last_contact_date IS NULL OR last_contact_date < CURRENT_DATE - make_interval(days => $2)))
     )
     ORDER BY priority_level DESC, last_contact_date ASC NULLS FIRST`,
    [toDayCount(priorityDays, 14), toDayCount(normalDays, 28)]
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
 * Everyone Claude can match a mention to: live (not merged) people with
 * their latest 3 updates for context.
 */
export async function getRoster(): Promise<RosterPerson[]> {
  const result = await getPool().query<RosterPerson>(
    `SELECT p.id, p.name, p.aliases, p.relationship,
            COALESCE((SELECT array_agg(u.update_text ORDER BY u.created_at DESC)
                      FROM (SELECT update_text, created_at FROM person_updates
                            WHERE person_id = p.id ORDER BY created_at DESC LIMIT 3) u), '{}') AS recent
     FROM people p
     WHERE p.merged_into_id IS NULL
     ORDER BY p.name`
  );
  return result.rows;
}

/** Add nicknames to a person (skips ones they already have, any capitalization). */
export async function addAliases(personId: string, aliases: string[]): Promise<void> {
  if (aliases.length === 0) return;
  await getPool().query(
    `UPDATE people
     SET aliases = aliases || ARRAY(
           SELECT DISTINCT a FROM unnest($2::text[]) a
           WHERE LOWER(a) <> ALL(SELECT LOWER(unnest(aliases))) AND LOWER(a) <> LOWER(name)),
         updated_at = NOW()
     WHERE id = $1`,
    [personId, aliases]
  );
}

/** Park a mention we couldn't pin to one person until Maddie says who it was. */
export async function createPendingMention(
  mention: string,
  candidateIds: string[],
  extracted: unknown,
  source: { kind: 'voice' | 'manual'; entryId: string },
  occurredAt: Date
): Promise<void> {
  await getPool().query(
    `INSERT INTO pending_mentions (mention, candidate_ids, extracted, source_kind, source_entry_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [mention, candidateIds, JSON.stringify(extracted), source.kind, source.entryId, occurredAt]
  );
}

/** Live people with the fields the Contacts matcher needs. */
export async function getPeopleForMatching(): Promise<Array<Pick<Person, 'id' | 'name' | 'aliases' | 'phone_numbers' | 'birthday'>>> {
  const result = await getPool().query(
    `SELECT id, name, aliases, phone_numbers, birthday FROM people WHERE merged_into_id IS NULL ORDER BY name`
  );
  return result.rows;
}

/**
 * Save what Contacts knows about a person. A new full name keeps the old
 * name as a nickname ("Grace" -> "Grace Smith", aka Grace).
 */
export async function setContactInfo(
  personId: string,
  info: { fullName: string | null; phoneNumbers: string[]; birthday: string | null }
): Promise<void> {
  await getPool().query(
    `UPDATE people
     SET aliases = CASE WHEN $2::text IS NOT NULL AND LOWER($2) <> LOWER(name)
                             AND LOWER(name) <> ALL(SELECT LOWER(unnest(aliases)))
                        THEN aliases || name ELSE aliases END,
         name = COALESCE($2, name),
         phone_numbers = ARRAY(SELECT DISTINCT unnest(phone_numbers || $3::text[])),
         birthday = COALESCE(birthday, $4::date),
         updated_at = NOW()
     WHERE id = $1`,
    [personId, info.fullName, info.phoneNumbers, info.birthday]
  );
}

/**
 * Merge a duplicate into the person to keep. Everything about the duplicate
 * moves over; the duplicate row is kept (merged_into_id set), not deleted.
 * All or nothing: runs in one transaction.
 */
export async function mergePeople(survivorId: string, duplicateId: string): Promise<{ moved: Record<string, number> }> {
  if (survivorId === duplicateId) throw new Error('Cannot merge a person into themselves');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const rows = (await client.query<MergeablePerson & { merged_into_id: string | null }>(
      `SELECT id, name, aliases, relationship, priority_level, last_contact_date, phone_numbers, birthday, merged_into_id
       FROM people WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[survivorId, duplicateId]]
    )).rows;
    const survivor = rows.find(r => r.id === survivorId);
    const duplicate = rows.find(r => r.id === duplicateId);
    if (!survivor || !duplicate) throw new Error('Person not found');
    if (survivor.merged_into_id || duplicate.merged_into_id) throw new Error('One of these people was already merged');

    const merged = planMerge(survivor, duplicate);
    await client.query(
      `UPDATE people SET aliases = $2, relationship = $3, priority_level = $4, last_contact_date = $5,
              phone_numbers = $6, birthday = $7, updated_at = NOW()
       WHERE id = $1`,
      [survivorId, merged.aliases, merged.relationship, merged.priority_level, merged.last_contact_date,
       merged.phone_numbers, merged.birthday]
    );

    const moved: Record<string, number> = {};
    for (const table of ['person_updates', 'friend_events', 'friend_situations', 'reminder_log']) {
      const res = await client.query(`UPDATE ${table} SET person_id = $1 WHERE person_id = $2`, [survivorId, duplicateId]);
      moved[table] = res.rowCount ?? 0;
    }
    await client.query(
      `UPDATE pending_mentions SET resolved_person_id = $1 WHERE resolved_person_id = $2`,
      [survivorId, duplicateId]
    );
    await client.query(
      `UPDATE pending_mentions SET candidate_ids = array_replace(candidate_ids, $2, $1)
       WHERE $2 = ANY(candidate_ids)`,
      [survivorId, duplicateId]
    );
    await client.query(
      `UPDATE people SET merged_into_id = $1, updated_at = NOW() WHERE id = $2`,
      [survivorId, duplicateId]
    );
    await client.query('COMMIT');
    return { moved };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Claim a digest (e.g. the 'morning' digest for '2026-10-14') before sending it.
 * Returns true if we got the claim, false if it was already claimed - so a
 * restart or a second copy of the server never sends the same digest twice.
 */
export async function claimDigest(digestDate: string, digestType: string): Promise<boolean> {
  const result = await getPool().query(
    `INSERT INTO digest_log (digest_date, digest_type)
     VALUES ($1, $2)
     ON CONFLICT (digest_date, digest_type) DO NOTHING
     RETURNING digest_date`,
    [digestDate, digestType]
  );

  return result.rows.length > 0;
}

/**
 * Record whether the SMS and email of a claimed digest went out
 */
export async function recordDigestResult(
  digestDate: string,
  digestType: string,
  smsOk: boolean,
  emailOk: boolean
): Promise<void> {
  await getPool().query(
    `UPDATE digest_log
     SET sms_ok = $3, email_ok = $4, sent_at = NOW()
     WHERE digest_date = $1 AND digest_type = $2`,
    [digestDate, digestType, smsOk, emailOk]
  );
}

/**
 * Give up a claim (when nothing could be sent), so a manual re-run can retry
 */
export async function releaseDigestClaim(digestDate: string, digestType: string): Promise<void> {
  await getPool().query(
    `DELETE FROM digest_log WHERE digest_date = $1 AND digest_type = $2`,
    [digestDate, digestType]
  );
}

/**
 * Everyone with a birthday: from Contacts (people.birthday), or else a
 * birthday mentioned on a call/text. Dates as 'YYYY-MM-DD' text.
 */
export async function getBirthdays(): Promise<Array<{ name: string; birthday: string }>> {
  const result = await getPool().query(
    `SELECT p.name, to_char(p.birthday, 'YYYY-MM-DD') AS birthday
     FROM people p
     WHERE p.merged_into_id IS NULL AND p.birthday IS NOT NULL
     UNION ALL
     SELECT DISTINCT ON (p.id) p.name, to_char(fe.event_date, 'YYYY-MM-DD')
     FROM friend_events fe JOIN people p ON p.id = fe.person_id
     WHERE fe.event_type = 'birthday' AND fe.event_date IS NOT NULL
       AND p.merged_into_id IS NULL AND p.birthday IS NULL`
  );
  return result.rows;
}

/** Non-birthday events with an exact date between two days (inclusive). */
export async function getDatedFriendEvents(fromDate: string, toDate: string): Promise<Array<{ name: string; description: string; eventType: string; date: string }>> {
  const result = await getPool().query(
    `SELECT p.name, fe.event_description AS description, fe.event_type AS "eventType",
            to_char(fe.event_date, 'YYYY-MM-DD') AS date
     FROM friend_events fe JOIN people p ON p.id = fe.person_id
     WHERE fe.event_type <> 'birthday' AND fe.event_date BETWEEN $1::date AND $2::date
     ORDER BY fe.event_date`,
    [fromDate, toDate]
  );
  return result.rows;
}

/** Live person who has any of these phone numbers (E.164), if one exists. */
export async function findPersonByPhones(phones: string[]): Promise<Pick<Person, 'id' | 'name'> | null> {
  const result = await getPool().query(
    `SELECT id, name FROM people WHERE merged_into_id IS NULL AND phone_numbers && $1::text[] LIMIT 1`,
    [phones]
  );
  return result.rows[0] || null;
}

/** Live person whose name or alias is exactly this (any capitalization). */
export async function findPersonByExactName(name: string): Promise<Pick<Person, 'id' | 'name'> | null> {
  const result = await getPool().query(
    `SELECT id, name FROM people
     WHERE merged_into_id IS NULL AND (LOWER(name) = LOWER($1) OR LOWER($1) = ANY(SELECT LOWER(unnest(aliases))))
     LIMIT 1`,
    [name]
  );
  return result.rows[0] || null;
}

/** Add someone from Contacts (name, numbers, birthday). */
export async function createPersonFromContact(name: string, phones: string[], birthday: string | null): Promise<void> {
  await getPool().query(
    `INSERT INTO people (name, aliases, relationship, phone_numbers, birthday) VALUES ($1, '{}', 'unknown', $2, $3::date)`,
    [name, phones, birthday]
  );
}

/** Latest day Maddie saw this person in person (never moves backwards). */
export async function updateLastSeenDate(personId: string, day: string): Promise<void> {
  await getPool().query(
    `UPDATE people SET last_seen_date = GREATEST(last_seen_date, $1::date), updated_at = NOW() WHERE id = $2`,
    [day, personId]
  );
}

/**
 * Priority people Maddie hasn't seen in person for at least `days` days
 * (or ever, as far as we know), longest first, with their latest update.
 */
export async function getPeopleToSee(days: number, limit: number): Promise<Array<{ name: string; lastSeen: string | null; latestUpdate: string | null }>> {
  const result = await getPool().query(
    `SELECT p.name, to_char(p.last_seen_date, 'YYYY-MM-DD') AS "lastSeen",
            (SELECT u.update_text FROM person_updates u WHERE u.person_id = p.id ORDER BY u.created_at DESC LIMIT 1) AS "latestUpdate"
     FROM people p
     WHERE p.merged_into_id IS NULL AND p.priority_level = 'high'
       AND (p.last_seen_date IS NULL OR p.last_seen_date < CURRENT_DATE - make_interval(days => $1))
     ORDER BY p.last_seen_date ASC NULLS FIRST, p.name
     LIMIT $2`,
    [toDayCount(days, 21), limit]
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
