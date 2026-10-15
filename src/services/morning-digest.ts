import { CalendarEvent, dateKeyInTimeZone, dayWindow } from './calendar';
import { seeSuggestionLines, type FriendReminder, type PersonToSee } from './friend-reminders-digest';

/**
 * Builds the text of the morning digest (no sending, no network, no DB),
 * so it is easy to test and preview.
 *
 * The digest is made of SECTIONS. Today there is one (calendar). To add one
 * later (e.g. friends): write a function that returns a DigestSection and
 * add it to the `sections` list in buildMorningDigest.
 */

/** Maddie's home time zone: the digest's "today" and all times use it. */
export const DIGEST_TIME_ZONE = 'America/New_York';

const SMS_MAX_CHARS = 600;
const SMS_MAX_EVENTS = 8;
const SMS_MAX_TITLE_CHARS = 60;
const SMS_MAX_LOCATION_CHARS = 40;

/** What we know about today's calendar. */
export type CalendarStatus =
  | { status: 'ok'; events: CalendarEvent[] }
  | { status: 'failed' } // the calendar couldn't be downloaded or read
  | { status: 'not_configured' }; // PERSONAL_CALENDAR_ICS_URL isn't set

/** Birthday / important-date reminders, or why we don't have them. */
export type FriendsStatus =
  | { status: 'ok'; reminders: FriendReminder[]; toSee?: PersonToSee[] }
  | { status: 'failed' } // the database couldn't be read
  | { status: 'skipped' }; // e.g. a preview with no database

export interface MorningDigestInput {
  /** The digest's day, 'YYYY-MM-DD' in DIGEST_TIME_ZONE. */
  date: string;
  calendar: CalendarStatus;
  friends?: FriendsStatus;
}

export interface MorningDigest {
  sms: string;
  emailSubject: string;
  emailText: string;
}

/** One part of the digest. */
interface DigestSection {
  /** Heading in the email, e.g. 'CALENDAR'. */
  emailHeading: string;
  emailLines: string[];
  /** Text message lines; must fit in `maxChars` (counting a newline per line). */
  smsLines: (maxChars: number) => string[];
  /** A few words for the email subject, e.g. '3 events'. */
  subjectSummary: string;
}

export function buildMorningDigest({ date, calendar, friends = { status: 'skipped' } }: MorningDigestInput): MorningDigest {
  // Friends first: they're short and the most likely to need action today.
  const sections: DigestSection[] = [friendsSection(friends), calendarSection(calendar, date), toSeeSection(friends, date)]
    .filter((section): section is DigestSection => section !== null);

  // Text message: header, then each section in the space that's left.
  const smsHeader = `Good morning! ${shortDate(date)}:`;
  const smsLines = [smsHeader];
  let charsLeft = SMS_MAX_CHARS - smsHeader.length;
  for (const section of sections) {
    const lines = section.smsLines(charsLeft);
    smsLines.push(...lines);
    charsLeft -= lines.reduce((sum, line) => sum + line.length + 1, 0);
  }

  const emailParts = [`Good morning! Here's ${longDate(date)}.`];
  for (const section of sections) {
    emailParts.push(`${section.emailHeading}\n${section.emailLines.join('\n')}`);
  }

  return {
    // Last-resort cap in case a section misbehaves.
    sms: truncate(smsLines.join('\n'), SMS_MAX_CHARS),
    emailSubject: `Morning digest: ${shortDate(date)} - ${sections.map((s) => s.subjectSummary).join(', ')}`,
    emailText: emailParts.join('\n\n') + '\n',
  };
}

// ---------------------------------------------------------------------------
// Friends section ("text them"): left out entirely on days with nothing to say
// ---------------------------------------------------------------------------

function friendsSection(friends: FriendsStatus): DigestSection | null {
  if (friends.status === 'skipped') return null;
  if (friends.status === 'failed') {
    const line = "• Couldn't load birthday/friend reminders today.";
    return { emailHeading: 'TEXT THEM', emailLines: [line], smsLines: () => [line], subjectSummary: "reminders didn't load" };
  }
  if (friends.reminders.length === 0) return null;
  const lines = friends.reminders.map(r => `• ${r.text}`);
  return {
    emailHeading: 'TEXT THEM',
    emailLines: lines,
    // At most half the text, so today's calendar still fits.
    smsLines: (maxChars) => fitWithMoreLine(lines.map(l => truncate(l, 120)), Math.min(maxChars, SMS_MAX_CHARS / 2)),
    subjectSummary: friends.reminders.length === 1 ? '1 friend reminder' : `${friends.reminders.length} friend reminders`,
  };
}

/** Mondays: important people Maddie hasn't seen in a while. Email only (keeps the text short). */
function toSeeSection(friends: FriendsStatus, date: string): DigestSection | null {
  if (friends.status !== 'ok' || !friends.toSee?.length) return null;
  return {
    emailHeading: 'MAKE A PLAN THIS WEEK (haven\'t seen in a while)',
    emailLines: seeSuggestionLines(date, friends.toSee),
    smsLines: () => [],
    subjectSummary: `${friends.toSee.length} to see`,
  };
}

// ---------------------------------------------------------------------------
// Calendar section
// ---------------------------------------------------------------------------

function calendarSection(calendar: CalendarStatus, date: string): DigestSection {
  if (calendar.status !== 'ok') {
    // Never say "nothing today" when we couldn't actually read the calendar.
    const message =
      calendar.status === 'failed'
        ? "Couldn't load your calendar this morning — check it manually."
        : "Your calendar isn't connected yet (PERSONAL_CALENDAR_ICS_URL isn't set).";
    return {
      emailHeading: 'CALENDAR',
      emailLines: [message],
      smsLines: () => [message],
      subjectSummary: calendar.status === 'failed' ? "calendar didn't load" : 'calendar not connected',
    };
  }

  const { events } = calendar;
  if (events.length === 0) {
    const message = 'Nothing on your personal calendar today.';
    return {
      emailHeading: 'CALENDAR',
      emailLines: [message],
      smsLines: () => [message],
      subjectSummary: 'nothing on the calendar',
    };
  }

  const window = dayWindow(date, DIGEST_TIME_ZONE);
  return {
    emailHeading: 'CALENDAR',
    emailLines: events.flatMap((event) => emailEventLines(event, date)),
    smsLines: (maxChars) =>
      fitWithMoreLine(events.map((event) => smsEventLine(event, window)), maxChars),
    subjectSummary: events.length === 1 ? '1 event' : `${events.length} events`,
  };
}

/** e.g. "• 8:00 AM Dentist (Main St Dental)" */
function smsEventLine(event: CalendarEvent, window: { start: Date; end: Date }): string {
  const title = truncate(event.title, SMS_MAX_TITLE_CHARS);
  const where = event.location ? ` (${truncate(event.location, SMS_MAX_LOCATION_CHARS)})` : '';

  const startedEarlier = event.start < window.start;
  const endsLater = !event.end || event.end >= window.end;
  if (event.allDay || (startedEarlier && endsLater)) return `• All day: ${title}${where}`;
  if (startedEarlier && event.end) return `• Until ${formatTime(event.end)} ${title}${where}`;
  return `• ${formatTime(event.start)} ${title}${where}`;
}

/**
 * Show as many lines as fit (at most SMS_MAX_EVENTS), then "+N more (see email)".
 */
function fitWithMoreLine(lines: string[], maxChars: number): string[] {
  const size = (list: string[]) => list.reduce((sum, line) => sum + line.length + 1, 0);
  for (let shown = Math.min(lines.length, SMS_MAX_EVENTS); shown >= 0; shown--) {
    const hidden = lines.length - shown;
    const candidate = hidden > 0 ? [...lines.slice(0, shown), `+${hidden} more (see email)`] : lines;
    if (size(candidate) <= maxChars) return candidate;
  }
  return [`${lines.length} events (see email)`];
}

/** Every detail: start AND end time, full location. */
function emailEventLines(event: CalendarEvent, date: string): string[] {
  let when: string;
  if (event.allDay) {
    // event.end is midnight AFTER the last day.
    const firstDay = dateKeyInTimeZone(event.start, DIGEST_TIME_ZONE);
    const lastDay = event.end
      ? dateKeyInTimeZone(new Date(event.end.getTime() - 1), DIGEST_TIME_ZONE)
      : firstDay;
    when = firstDay === lastDay ? 'All day' : `All day (${shortDate(firstDay)} – ${shortDate(lastDay)})`;
  } else {
    const start = formatTimeOn(event.start, date);
    when = event.end ? `${start} – ${formatTimeOn(event.end, date)}` : start;
  }

  const lines = [`• ${when}: ${event.title}`];
  if (event.location) lines.push(`    Where: ${event.location}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DIGEST_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

/** "8:00 AM" in New York time. */
function formatTime(instant: Date): string {
  // Newer Node versions put a special narrow space before AM/PM; use a normal one.
  return timeFormat.format(instant).replace(/\s/g, ' ');
}

/** "8:00 AM", or "Tue 10:00 PM" when the time isn't on the digest's day. */
function formatTimeOn(instant: Date, date: string): string {
  const day = dateKeyInTimeZone(instant, DIGEST_TIME_ZONE);
  return day === date ? formatTime(instant) : `${shortDate(day).split(' ')[0]} ${formatTime(instant)}`;
}

/** '2026-10-14' -> 'Wed Oct 14' */
function shortDate(date: string): string {
  const { weekday, month, day } = dateParts(date, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${weekday} ${month} ${day}`;
}

/** '2026-10-14' -> 'Wednesday, October 14' */
function longDate(date: string): string {
  const { weekday, month, day } = dateParts(date, { weekday: 'long', month: 'long', day: 'numeric' });
  return `${weekday}, ${month} ${day}`;
}

function dateParts(date: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const [year, month, day] = date.split('-').map(Number);
  // Noon UTC on that date, formatted in UTC, so the date can't shift.
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).formatToParts(noon)) {
    parts[part.type] = part.value;
  }
  return parts;
}

/** Cut text to `max` characters, ending with "…" if it was cut. */
function truncate(text: string, max: number): string {
  const chars = Array.from(text); // so emoji aren't cut in half
  return chars.length <= max ? text : chars.slice(0, max - 1).join('').trimEnd() + '…';
}
