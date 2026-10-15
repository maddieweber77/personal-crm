import { readFile } from 'fs/promises';
import { dateKeyInTimeZone, fetchCalendarIcs, getEventsForDay, redactSecret } from './calendar';
import { buildMorningDigest, CalendarStatus, DIGEST_TIME_ZONE, FriendsStatus, MorningDigest } from './morning-digest';
import { friendReminders } from './friend-reminders-digest';
import { sendEmail, sendSms } from './notify';
import { claimDigest, recordDigestResult, releaseDigestClaim, getBirthdays, getDatedFriendEvents } from '../database/client';

/**
 * The morning digest job: load today's calendar, build the digest, send it
 * by SMS and email. Runs at 7:30am ET from src/index.ts, or by hand with
 * `npm run digest:preview` / `npm run digest:send`.
 */

const DIGEST_TYPE = 'morning';
const DEFAULT_DIGEST_PHONE = '+17049997750'; // Maddie's number (same as src/routes/webhook.ts)

export interface RunMorningDigestOptions {
  /** Build the digest and return it, but send nothing and don't touch the database. */
  dryRun?: boolean;
  /** Read the calendar from this local .ics file instead of PERSONAL_CALENDAR_ICS_URL. */
  icsFile?: string;
  /** Day to build, 'YYYY-MM-DD'. Default: today in New York. */
  date?: string;
}

export type MorningDigestResult =
  | { outcome: 'preview'; date: string; digest: MorningDigest }
  | { outcome: 'already_sent'; date: string }
  | { outcome: 'sent'; date: string; digest: MorningDigest; smsOk: boolean; emailOk: boolean }
  | { outcome: 'failed'; date: string; digest: MorningDigest }; // SMS and email both failed

export async function runMorningDigest(options: RunMorningDigestOptions = {}): Promise<MorningDigestResult> {
  const { dryRun = false, icsFile } = options;
  const date = options.date ?? dateKeyInTimeZone(new Date(), DIGEST_TIME_ZONE);

  if (dryRun) {
    // Preview reads friends only when a database is configured (read-only).
    const friends: FriendsStatus = process.env.DATABASE_URL ? await loadFriends(date) : { status: 'skipped' };
    const digest = buildMorningDigest({ date, calendar: await loadCalendar(date, icsFile), friends });
    return { outcome: 'preview', date, digest };
  }

  // 1. Claim the day FIRST. If the row already exists, someone (a restart,
  //    a second copy of the server) already sent it.
  if (!(await claimDigest(date, DIGEST_TYPE))) {
    console.log(`Morning digest for ${date} was already sent - skipping`);
    return { outcome: 'already_sent', date };
  }

  let smsOk = false;
  let emailOk = false;
  try {
    const digest = buildMorningDigest({ date, calendar: await loadCalendar(date, icsFile), friends: await loadFriends(date) });

    // 2. Send both. sendSms/sendEmail never throw, so a failed text (e.g. the
    //    toll-free number isn't verified yet) never stops the email.
    smsOk = await sendSms(process.env.DIGEST_TO_PHONE || DEFAULT_DIGEST_PHONE, digest.sms);
    emailOk = await sendEmail(digest.emailSubject, digest.emailText);

    // 3. Nothing went out: give the day back so a manual re-run can retry.
    if (!smsOk && !emailOk) {
      await releaseDigestClaim(date, DIGEST_TYPE);
      console.error(`Morning digest for ${date}: SMS and email both failed (run "npm run digest:send" to retry)`);
      return { outcome: 'failed', date, digest };
    }

    await recordDigestResult(date, DIGEST_TYPE, smsOk, emailOk);
    console.log(`✓ Morning digest for ${date} done (sms: ${smsOk ? 'ok' : 'failed'}, email: ${emailOk ? 'ok' : 'failed'})`);
    return { outcome: 'sent', date, digest, smsOk, emailOk };
  } catch (error) {
    // Unexpected error. If nothing was sent, free the day for a retry;
    // if something WAS sent, keep the claim so a retry can't double-send.
    if (!smsOk && !emailOk) {
      await releaseDigestClaim(date, DIGEST_TYPE).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Today's events, or why we don't have them. Never throws: a broken calendar
 * becomes { status: 'failed' } so the digest can say so.
 */
async function loadCalendar(date: string, icsFile?: string): Promise<CalendarStatus> {
  const url = process.env.PERSONAL_CALENDAR_ICS_URL?.trim();

  try {
    let icsText: string;
    if (icsFile) {
      icsText = await readFile(icsFile, 'utf-8');
    } else if (url) {
      icsText = await fetchCalendarIcs(url);
    } else {
      return { status: 'not_configured' };
    }
    return { status: 'ok', events: getEventsForDay(icsText, date, DIGEST_TIME_ZONE) };
  } catch (error) {
    // Message only, with the secret URL scrubbed out (belt and braces).
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Couldn't load the calendar: ${redactSecret(message, url)}`);
    return { status: 'failed' };
  }
}

/**
 * Birthday and important-date reminders for `date`. Never throws: a database
 * problem becomes { status: 'failed' } so the digest can say so.
 */
async function loadFriends(date: string): Promise<FriendsStatus> {
  try {
    const tomorrow = new Date(`${date}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const [birthdays, events] = await Promise.all([
      getBirthdays(),
      getDatedFriendEvents(date, tomorrow.toISOString().slice(0, 10)),
    ]);
    return { status: 'ok', reminders: friendReminders(date, birthdays, events) };
  } catch (error) {
    console.error(`Couldn't load friend reminders: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 'failed' };
  }
}
