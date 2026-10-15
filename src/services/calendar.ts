import axios from 'axios';
import ICAL from 'ical.js';

/**
 * Reads Maddie's personal Google Calendar from its "Secret address in iCal
 * format" (.ics feed) and works out which events happen on a given day.
 *
 * The .ics URL is a secret (anyone with it can read the calendar), so it is
 * never logged and never put in an error message.
 */

/** One event (or one occurrence of a repeating event) on the calendar. */
export interface CalendarEvent {
  title: string;
  /** All-day events: midnight (in the requested time zone) of the first day. */
  start: Date;
  /** Timed events with no end time: null. All-day events: midnight after the last day. */
  end: Date | null;
  allDay: boolean;
  location: string | null;
}

/** The email on the calendar whose "declined" answers hide events. */
const DEFAULT_OWNER_EMAIL = 'maddieweber7@gmail.com';

/**
 * Safety cap for repeating events: stop after this many occurrences.
 * A daily event that started in 1900 is ~46,000 occurrences, so real events
 * never hit this; it only stops a broken rule from looping forever.
 */
const MAX_OCCURRENCES_PER_EVENT = 50_000;

/**
 * Download the .ics feed as text (15 second timeout).
 * Throws an Error whose message never contains the URL.
 */
export async function fetchCalendarIcs(url: string): Promise<string> {
  let body: unknown;
  try {
    const response = await axios.get(url, { timeout: 15_000, responseType: 'text' });
    body = response.data;
  } catch (error) {
    // Build a brand-new error: axios errors carry the URL in error.config.
    throw new Error(`Calendar download failed: ${redactSecret(errorMessage(error), url)}`);
  }

  // A reset/expired secret URL returns an error page, not an iCal feed.
  if (typeof body !== 'string' || !body.includes('BEGIN:VCALENDAR')) {
    throw new Error('Calendar download did not return an iCal feed');
  }
  return body;
}

/**
 * Every event that happens (even partly) on `day` in `timeZone`.
 *
 * Pure function (no network, no database) so it is easy to test.
 * Sorted: all-day events first, then by start time.
 *
 * @param icsText    the whole .ics feed
 * @param day        'YYYY-MM-DD', e.g. '2026-10-14'
 * @param timeZone   IANA zone the day is in, e.g. 'America/New_York'
 * @param ownerEmail events this attendee declined are left out
 */
export function getEventsForDay(
  icsText: string,
  day: string,
  timeZone: string,
  ownerEmail: string = process.env.CALENDAR_OWNER_EMAIL || DEFAULT_OWNER_EMAIL
): CalendarEvent[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Day must look like YYYY-MM-DD (got "${day}")`);
  }

  const jcal = ICAL.parse(icsText);
  if (!Array.isArray(jcal) || jcal[0] !== 'vcalendar') {
    throw new Error('Calendar data is not an iCal feed');
  }
  const calendar = new ICAL.Component(jcal);

  // Time zones must be known before any event time is read.
  registerTimezones(calendar);

  const ctx: DayContext = {
    window: dayWindow(day, timeZone),
    timeZone,
    ownerEmail: normalizeEmail(ownerEmail),
  };

  // A repeating event is one "master" VEVENT (with the RRULE) plus one VEVENT
  // per changed instance (same UID, with a RECURRENCE-ID saying which
  // instance it replaces). We call those changed instances "overrides".
  const vevents = calendar.getAllSubcomponents('vevent');
  const masters = vevents.filter((c) => !c.hasProperty('recurrence-id'));
  const overrides = vevents.filter((c) => c.hasProperty('recurrence-id'));

  const overridesByUid = new Map<string, ICAL.Component[]>();
  for (const override of overrides) {
    const uid = uidOf(override);
    overridesByUid.set(uid, [...(overridesByUid.get(uid) ?? []), override]);
  }

  // If the whole series was cancelled, its moved instances are cancelled too.
  const cancelledUids = new Set(masters.filter(isCancelled).map(uidOf));

  const events: CalendarEvent[] = [];

  for (const master of masters) {
    try {
      events.push(...occurrencesOfMaster(master, overridesByUid.get(uidOf(master)) ?? [], ctx));
    } catch (error) {
      // One broken event shouldn't hide the rest of the day.
      console.warn(`Skipped a calendar event that couldn't be read: ${errorMessage(error)}`);
    }
  }

  // Overrides are checked on their own (at their NEW time), so an instance
  // moved onto today from another day still shows up.
  for (const override of overrides) {
    if (cancelledUids.has(uidOf(override))) continue;
    try {
      const event = singleOccurrence(override, ctx);
      if (event) events.push(event);
    } catch (error) {
      console.warn(`Skipped a calendar event that couldn't be read: ${errorMessage(error)}`);
    }
  }

  return events.sort(compareEvents);
}

// ---------------------------------------------------------------------------
// Events and repeating events
// ---------------------------------------------------------------------------

interface DayContext {
  window: { start: Date; end: Date };
  timeZone: string;
  ownerEmail: string;
}

/** Where one occurrence sits in time (before we decide whether to show it). */
interface Occurrence {
  start: Date;
  end: Date;
  allDay: boolean;
}

/** All occurrences of one master VEVENT (repeating or not) that touch the day. */
function occurrencesOfMaster(
  master: ICAL.Component,
  overrides: ICAL.Component[],
  ctx: DayContext
): CalendarEvent[] {
  if (isCancelled(master) || isDeclined(master, ctx.ownerEmail)) return [];

  // Pass the overrides in explicitly. (If we didn't, ical.js would grab every
  // RECURRENCE-ID event in the whole calendar, even other events' ones.)
  const event = new ICAL.Event(master, { strictExceptions: true, exceptions: overrides });
  if (!event.startDate) return [];

  const floatingZone = floatingZoneFor(master, ctx.timeZone);

  if (!event.isRecurring()) {
    const occurrence = toOccurrence(event.startDate, event.endDate, floatingZone, ctx.timeZone);
    return touchesDay(occurrence, ctx.window) ? [toCalendarEvent(master, occurrence)] : [];
  }

  // Instances that have an override are handled by the override itself.
  // (RECURRENCE-ID = the original start time of the instance it replaces.)
  const overriddenStarts = new Set<number>();
  for (const override of overrides) {
    const recurrenceId = override.getFirstPropertyValue('recurrence-id');
    if (recurrenceId instanceof ICAL.Time) {
      overriddenStarts.add(toInstant(recurrenceId, floatingZone, ctx.timeZone).getTime());
    }
  }
  const isExcluded = exdateChecker(master, floatingZone, ctx.timeZone);

  const results: CalendarEvent[] = [];
  const iterator = event.iterator();

  for (let count = 0; count < MAX_OCCURRENCES_PER_EVENT; count++) {
    const next = iterator.next();
    if (!next) return results; // the rule has no more occurrences

    const instanceStart = toInstant(next, floatingZone, ctx.timeZone);
    // Occurrences come in time order, so once one starts after today we're done.
    if (instanceStart >= ctx.window.end) return results;

    if (overriddenStarts.has(instanceStart.getTime()) || isExcluded(next, instanceStart)) continue;

    // getOccurrenceDetails works out this instance's end time (and applies
    // any "this and all following" change, which some calendars use).
    const details = event.getOccurrenceDetails(next);
    const source = details.item.component;
    if (source !== master && (isCancelled(source) || isDeclined(source, ctx.ownerEmail))) continue;

    const occurrence = toOccurrence(details.startDate, details.endDate, floatingZone, ctx.timeZone);
    if (touchesDay(occurrence, ctx.window)) results.push(toCalendarEvent(source, occurrence));
  }

  console.warn(`A repeating calendar event has over ${MAX_OCCURRENCES_PER_EVENT} occurrences before today; stopped reading it.`);
  return results;
}

/** One override (a changed instance of a repeating event), at its own time. */
function singleOccurrence(component: ICAL.Component, ctx: DayContext): CalendarEvent | null {
  if (isCancelled(component) || isDeclined(component, ctx.ownerEmail)) return null;

  const event = new ICAL.Event(component, { exceptions: [] });
  if (!event.startDate) return null;

  const floatingZone = floatingZoneFor(component, ctx.timeZone);
  const occurrence = toOccurrence(event.startDate, event.endDate, floatingZone, ctx.timeZone);
  return touchesDay(occurrence, ctx.window) ? toCalendarEvent(component, occurrence) : null;
}

/**
 * EXDATE = "skip this instance". ical.js also applies EXDATEs, but it can miss
 * one when an earlier EXDATE doesn't match any instance (it only moves past
 * one EXDATE per instance), so we double-check every instance ourselves.
 */
function exdateChecker(
  master: ICAL.Component,
  floatingZone: string,
  timeZone: string
): (instance: ICAL.Time, instanceStart: Date) => boolean {
  const excludedInstants = new Set<number>();
  const excludedDates = new Set<string>(); // EXDATE;VALUE=DATE skips that whole date

  for (const prop of master.getAllProperties('exdate')) {
    for (const value of prop.getValues() as ICAL.Time[]) {
      if (value.isDate) {
        excludedDates.add(value.toString()); // 'YYYY-MM-DD'
      } else {
        excludedInstants.add(toInstant(value, floatingZone, timeZone).getTime());
      }
    }
  }

  return (instance, instanceStart) =>
    excludedInstants.has(instanceStart.getTime()) ||
    excludedDates.has(instance.toString().slice(0, 10));
}

function toCalendarEvent(component: ICAL.Component, occurrence: Occurrence): CalendarEvent {
  const zeroLength = occurrence.end.getTime() === occurrence.start.getTime();
  return {
    title: cleanText(component.getFirstPropertyValue('summary')) || '(No title)',
    start: occurrence.start,
    end: !occurrence.allDay && zeroLength ? null : occurrence.end,
    allDay: occurrence.allDay,
    location: cleanText(component.getFirstPropertyValue('location')) || null,
  };
}

/** Turn ical.js start/end times into real instants. */
function toOccurrence(
  startTime: ICAL.Time,
  endTime: ICAL.Time | null,
  floatingZone: string,
  timeZone: string
): Occurrence {
  if (startTime.isDate) {
    // All-day: DTEND is the day AFTER the last day (exclusive).
    const start = toInstant(startTime, floatingZone, timeZone);
    let end = endTime ? toInstant(endTime, floatingZone, timeZone) : start;
    if (end <= start) {
      // No (or a broken) end date means a one-day event.
      end = startOfDay(addDays(startTime.toString().slice(0, 10), 1), timeZone);
    }
    return { start, end, allDay: true };
  }

  const start = toInstant(startTime, floatingZone, timeZone);
  let end = endTime ? toInstant(endTime, floatingZone, timeZone) : start;
  if (end < start) end = start; // broken data: treat as no end time
  return { start, end, allDay: false };
}

/**
 * Does this occurrence happen (at least partly) during the day?
 * Zero-length events count if they start during the day.
 */
function touchesDay(occurrence: Occurrence, window: { start: Date; end: Date }): boolean {
  return (
    occurrence.start < window.end &&
    (occurrence.end > window.start || occurrence.start >= window.start)
  );
}

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title);
}

// ---------------------------------------------------------------------------
// Event properties
// ---------------------------------------------------------------------------

function uidOf(component: ICAL.Component): string {
  return String(component.getFirstPropertyValue('uid') ?? '');
}

function isCancelled(component: ICAL.Component): boolean {
  return String(component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

/** Did `ownerEmail` answer "No" to this invite? */
function isDeclined(component: ICAL.Component, ownerEmail: string): boolean {
  return component.getAllProperties('attendee').some(
    (attendee) =>
      normalizeEmail(String(attendee.getFirstValue() ?? '')) === ownerEmail &&
      String(attendee.getParameter('partstat') ?? '').toUpperCase() === 'DECLINED'
  );
}

/** 'mailto:Maddie@Example.com' -> 'maddie@example.com' */
function normalizeEmail(value: string): string {
  return value.trim().replace(/^mailto:/i, '').toLowerCase();
}

/** Squash newlines/extra spaces; empty -> ''. */
function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

/** Tell ical.js about every VTIMEZONE in the feed (e.g. America/New_York). */
function registerTimezones(calendar: ICAL.Component): void {
  for (const vtimezone of calendar.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(vtimezone);
    } catch (error) {
      console.warn(`Skipped a time zone in the calendar that couldn't be read: ${errorMessage(error)}`);
    }
  }
}

/**
 * Times with no time zone ("floating") mean "local time". If the event names
 * a real time zone that the feed forgot to define, use it; otherwise use the
 * zone we're building the digest for.
 */
function floatingZoneFor(component: ICAL.Component, timeZone: string): string {
  const tzid = component.getFirstProperty('dtstart')?.getParameter('tzid');
  return typeof tzid === 'string' && isValidTimeZone(tzid) ? tzid : timeZone;
}

/**
 * Convert an ical.js time to a real instant.
 * - Dates (all-day) -> midnight in `timeZone`
 * - Floating times  -> that wall-clock time in `floatingZone`
 * - Everything else -> ical.js knows the zone, so it can do it
 */
function toInstant(time: ICAL.Time, floatingZone: string, timeZone: string): Date {
  if (time.isDate) {
    return zonedTimeToDate(time.year, time.month, time.day, 0, 0, 0, timeZone);
  }
  if (time.zone === ICAL.Timezone.localTimezone) {
    return zonedTimeToDate(time.year, time.month, time.day, time.hour, time.minute, time.second, floatingZone);
  }
  return new Date(time.toUnixTime() * 1000);
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Day helpers (also used by the digest job and composer)
// ---------------------------------------------------------------------------

/** The instants a calendar day starts and ends in a time zone (end is exclusive). */
export function dayWindow(day: string, timeZone: string): { start: Date; end: Date } {
  return { start: startOfDay(day, timeZone), end: startOfDay(addDays(day, 1), timeZone) };
}

/** Today's (or `date`'s) calendar day in a time zone, as 'YYYY-MM-DD'. */
export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const p = wallClockParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** '2026-10-14' + 1 -> '2026-10-15' */
export function addDays(day: string, days: number): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, dayOfMonth + days)).toISOString().slice(0, 10);
}

function startOfDay(day: string, timeZone: string): Date {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return zonedTimeToDate(year, month, dayOfMonth, 0, 0, 0, timeZone);
}

/**
 * "This wall-clock time in this time zone" -> the real instant.
 * Handles daylight saving: e.g. midnight in New York is 04:00 UTC in
 * summer and 05:00 UTC in winter.
 */
function zonedTimeToDate(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timeZone: string
): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // First guess using the offset at that moment, then re-check in case
  // the guess landed on the other side of a daylight-saving change.
  const firstGuess = asIfUtc - zoneOffsetMs(asIfUtc, timeZone);
  const offset = zoneOffsetMs(firstGuess, timeZone);
  return new Date(asIfUtc - offset);
}

/** How far ahead of UTC the zone's clocks are at `instantMs` (negative in the US). */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const p = wallClockParts(new Date(instantMs), timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - Math.floor(instantMs / 1000) * 1000;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The year/month/day/hour/minute/second a clock in `timeZone` shows at `date`. */
function wallClockParts(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Replace every copy of a secret (e.g. the calendar URL) in a message. */
export function redactSecret(message: string, secret: string | undefined): string {
  if (!secret) return message;
  let result = message.split(secret).join('[calendar URL]');
  // Also catch the secret part on its own (in case a message shows only the path).
  try {
    const { pathname } = new URL(secret);
    if (pathname.length > 1) result = result.split(pathname).join('[calendar URL]');
  } catch {
    // not a URL; the full-string replace above is enough
  }
  return result;
}
