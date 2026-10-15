import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEventsForDay,
  dayWindow,
  dateKeyInTimeZone,
  addDays,
  redactSecret,
  type CalendarEvent,
} from '../src/services/calendar';
import { calendar, vevent } from './ics-fixtures';

// 2026-10-14 is a Wednesday. New York is on EDT (UTC-4) until 2026-11-01.
const TZ = 'America/New_York';
const OWNER = 'maddieweber7@gmail.com';

function eventsOn(ics: string, day: string): CalendarEvent[] {
  return getEventsForDay(ics, day, TZ, OWNER);
}

function titlesOn(ics: string, day: string): string[] {
  return eventsOn(ics, day).map((e) => e.title);
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

test('simple timed event (TZID) shows on its day only, with real UTC times', () => {
  const ics = calendar(
    vevent('dentist',
      'DTSTART;TZID=America/New_York:20261014T080000',
      'DTEND;TZID=America/New_York:20261014T090000',
      'SUMMARY:Dentist',
      'LOCATION:Main St Dental')
  );
  const [event, ...rest] = eventsOn(ics, '2026-10-14');
  assert.equal(rest.length, 0);
  assert.equal(event.title, 'Dentist');
  assert.equal(event.allDay, false);
  assert.equal(event.location, 'Main St Dental');
  assert.equal(iso(event.start), '2026-10-14T12:00:00.000Z');
  assert.equal(iso(event.end), '2026-10-14T13:00:00.000Z');
  assert.deepEqual(titlesOn(ics, '2026-10-13'), []);
  assert.deepEqual(titlesOn(ics, '2026-10-15'), []);
});

test('timed event written in UTC (Z), like Google often does', () => {
  const ics = calendar(
    vevent('dinner', 'DTSTART:20261014T223000Z', 'DTEND:20261015T000000Z', 'SUMMARY:Dinner with Grace')
  );
  const [event] = eventsOn(ics, '2026-10-14');
  assert.equal(event.title, 'Dinner with Grace');
  assert.equal(iso(event.start), '2026-10-14T22:30:00.000Z'); // 6:30 PM ET
  assert.deepEqual(titlesOn(ics, '2026-10-15'), []); // ends 8 PM ET on the 14th
});

test('all-day event covers its day; DTEND is the (exclusive) next day', () => {
  const ics = calendar(
    vevent('bday', 'DTSTART;VALUE=DATE:20261014', 'DTEND;VALUE=DATE:20261015', "SUMMARY:Sarah's birthday")
  );
  const [event] = eventsOn(ics, '2026-10-14');
  assert.equal(event.allDay, true);
  assert.equal(event.title, "Sarah's birthday");
  assert.equal(iso(event.start), '2026-10-14T04:00:00.000Z'); // midnight ET
  assert.equal(iso(event.end), '2026-10-15T04:00:00.000Z');
  assert.deepEqual(titlesOn(ics, '2026-10-13'), []);
  assert.deepEqual(titlesOn(ics, '2026-10-15'), []);
});

test('multi-day all-day event shows on every day it covers', () => {
  const ics = calendar(
    vevent('ski', 'DTSTART;VALUE=DATE:20261013', 'DTEND;VALUE=DATE:20261017', 'SUMMARY:Ski trip')
  );
  for (const day of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
    assert.deepEqual(titlesOn(ics, day), ['Ski trip'], day);
  }
  assert.deepEqual(titlesOn(ics, '2026-10-12'), []);
  assert.deepEqual(titlesOn(ics, '2026-10-17'), []);
});

test('weekly repeating event skips the instance removed with EXDATE', () => {
  const ics = calendar(
    vevent('standup',
      'DTSTART;TZID=America/New_York:20260902T090000',
      'DTEND;TZID=America/New_York:20260902T093000',
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
      'EXDATE;TZID=America/New_York:20261014T090000',
      'SUMMARY:Standup')
  );
  assert.deepEqual(titlesOn(ics, '2026-10-14'), []);
  const [nextWeek] = eventsOn(ics, '2026-10-21');
  assert.equal(nextWeek.title, 'Standup');
  assert.equal(iso(nextWeek.start), '2026-10-21T13:00:00.000Z');
  assert.equal(iso(nextWeek.end), '2026-10-21T13:30:00.000Z');
});

test('EXDATE still works when an earlier EXDATE matches no instance', () => {
  // ical.js alone gets this wrong (it falls one EXDATE behind), so the
  // service double-checks EXDATEs itself.
  const ics = calendar(
    vevent('standup',
      'DTSTART;TZID=America/New_York:20260902T090000',
      'DTEND;TZID=America/New_York:20260902T093000',
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
      'EXDATE;TZID=America/New_York:20261008T090000,20261014T090000',
      'SUMMARY:Standup')
  );
  assert.deepEqual(titlesOn(ics, '2026-10-14'), []);
  assert.deepEqual(titlesOn(ics, '2026-10-07'), ['Standup']);
});

test('RECURRENCE-ID override replaces the original instance at its new time', () => {
  const ics = calendar(
    vevent('sync',
      'DTSTART;TZID=America/New_York:20260902T100000',
      'DTEND;TZID=America/New_York:20260902T103000',
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
      'SUMMARY:Team sync'),
    vevent('sync',
      'RECURRENCE-ID;TZID=America/New_York:20261014T100000',
      'DTSTART;TZID=America/New_York:20261014T150000',
      'DTEND;TZID=America/New_York:20261014T153000',
      'SUMMARY:Team sync (moved)')
  );
  const today = eventsOn(ics, '2026-10-14');
  assert.equal(today.length, 1, 'the original 10 AM instance must not also show');
  assert.equal(today[0].title, 'Team sync (moved)');
  assert.equal(iso(today[0].start), '2026-10-14T19:00:00.000Z'); // 3 PM ET
  // Other weeks are untouched.
  const [nextWeek] = eventsOn(ics, '2026-10-21');
  assert.equal(nextWeek.title, 'Team sync');
  assert.equal(iso(nextWeek.start), '2026-10-21T14:00:00.000Z');
});

test('an instance moved onto today from another day shows; moved away does not', () => {
  const ics = calendar(
    // Thursday piano lesson; the Oct 15 lesson moved to Wed Oct 14 at 6 PM.
    vevent('piano',
      'DTSTART;TZID=America/New_York:20260903T170000',
      'DTEND;TZID=America/New_York:20260903T180000',
      'RRULE:FREQ=WEEKLY;BYDAY=TH',
      'SUMMARY:Piano'),
    vevent('piano',
      'RECURRENCE-ID;TZID=America/New_York:20261015T170000',
      'DTSTART;TZID=America/New_York:20261014T180000',
      'DTEND;TZID=America/New_York:20261014T190000',
      'SUMMARY:Piano'),
    // Wednesday yoga; the Oct 14 class moved to Fri Oct 16.
    vevent('yoga',
      'DTSTART;TZID=America/New_York:20260902T070000',
      'DTEND;TZID=America/New_York:20260902T080000',
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
      'SUMMARY:Yoga'),
    vevent('yoga',
      'RECURRENCE-ID;TZID=America/New_York:20261014T070000',
      'DTSTART;TZID=America/New_York:20261016T070000',
      'DTEND;TZID=America/New_York:20261016T080000',
      'SUMMARY:Yoga')
  );
  const today = eventsOn(ics, '2026-10-14');
  assert.deepEqual(today.map((e) => e.title), ['Piano']);
  assert.equal(iso(today[0].start), '2026-10-14T22:00:00.000Z');
  assert.deepEqual(titlesOn(ics, '2026-10-15'), []);
  assert.deepEqual(titlesOn(ics, '2026-10-16'), ['Yoga']);
});

test('cancelled events, cancelled instances and cancelled series are skipped', () => {
  const ics = calendar(
    vevent('lunch',
      'DTSTART;TZID=America/New_York:20261014T120000',
      'DTEND;TZID=America/New_York:20261014T130000',
      'STATUS:CANCELLED',
      'SUMMARY:Lunch'),
    // Repeating book club with only today's meeting cancelled.
    vevent('book',
      'DTSTART;TZID=America/New_York:20260902T190000',
      'DTEND;TZID=America/New_York:20260902T200000',
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
      'SUMMARY:Book club'),
    vevent('book',
      'RECURRENCE-ID;TZID=America/New_York:20261014T190000',
      'DTSTART;TZID=America/New_York:20261014T190000',
      'DTEND;TZID=America/New_York:20261014T200000',
      'STATUS:CANCELLED',
      'SUMMARY:Book club'),
    // Whole series cancelled, including an instance moved onto today.
    vevent('tennis',
      'DTSTART;TZID=America/New_York:20260903T080000',
      'DTEND;TZID=America/New_York:20260903T090000',
      'RRULE:FREQ=WEEKLY;BYDAY=TH',
      'STATUS:CANCELLED',
      'SUMMARY:Tennis'),
    vevent('tennis',
      'RECURRENCE-ID;TZID=America/New_York:20261015T080000',
      'DTSTART;TZID=America/New_York:20261014T080000',
      'DTEND;TZID=America/New_York:20261014T090000',
      'SUMMARY:Tennis')
  );
  assert.deepEqual(titlesOn(ics, '2026-10-14'), []);
  assert.deepEqual(titlesOn(ics, '2026-10-21'), ['Book club']);
});

test('events the owner declined are skipped (email match ignores case and mailto:)', () => {
  const ics = calendar(
    vevent('declined',
      'DTSTART;TZID=America/New_York:20261014T110000',
      'DTEND;TZID=America/New_York:20261014T120000',
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=DECLINED;CN=Maddie;X-NUM-GUESTS=0:MAILTO:MaddieWeber7@Gmail.com',
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Pat;X-NUM-GUESTS=0:mailto:pat@example.com',
      'SUMMARY:Boring meeting'),
    vevent('accepted',
      'DTSTART;TZID=America/New_York:20261014T140000',
      'DTEND;TZID=America/New_York:20261014T150000',
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Maddie;X-NUM-GUESTS=0:mailto:maddieweber7@gmail.com',
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=DECLINED;CN=Pat;X-NUM-GUESTS=0:mailto:pat@example.com',
      'SUMMARY:Coffee'),
    // Repeating event where only today's instance was declined.
    vevent('weekly',
      'DTSTART;TZID=America/New_York:20260902T160000',
      'DTEND;TZID=America/New_York:20260902T163000',
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
      'ATTENDEE;PARTSTAT=ACCEPTED:mailto:maddieweber7@gmail.com',
      'SUMMARY:1:1'),
    vevent('weekly',
      'RECURRENCE-ID;TZID=America/New_York:20261014T160000',
      'DTSTART;TZID=America/New_York:20261014T160000',
      'DTEND;TZID=America/New_York:20261014T163000',
      'ATTENDEE;PARTSTAT=DECLINED:mailto:maddieweber7@gmail.com',
      'SUMMARY:1:1')
  );
  assert.deepEqual(titlesOn(ics, '2026-10-14'), ['Coffee']);
  assert.deepEqual(titlesOn(ics, '2026-10-21'), ['1:1']);
  // A different owner email sees the declined meeting.
  assert.ok(getEventsForDay(ics, '2026-10-14', TZ, 'someone@else.com').some((e) => e.title === 'Boring meeting'));
});

test('event that started yesterday and runs past midnight is included', () => {
  const ics = calendar(
    vevent('redeye',
      'DTSTART;TZID=America/New_York:20261013T220000',
      'DTEND;TZID=America/New_York:20261014T020000',
      'SUMMARY:Red-eye flight'),
    // Ends exactly at midnight: belongs to yesterday only.
    vevent('party',
      'DTSTART;TZID=America/New_York:20261013T200000',
      'DTEND;TZID=America/New_York:20261014T000000',
      'SUMMARY:Party')
  );
  const today = eventsOn(ics, '2026-10-14');
  assert.deepEqual(today.map((e) => e.title), ['Red-eye flight']);
  assert.equal(iso(today[0].start), '2026-10-14T02:00:00.000Z'); // 10 PM ET on the 13th
  assert.equal(iso(today[0].end), '2026-10-14T06:00:00.000Z');
  assert.deepEqual(titlesOn(ics, '2026-10-13').sort(), ['Party', 'Red-eye flight']);
});

test('event in America/Los_Angeles is converted to the real instant', () => {
  const ics = calendar(
    vevent('la',
      'DTSTART;TZID=America/Los_Angeles:20261014T120000',
      'DTEND;TZID=America/Los_Angeles:20261014T130000',
      'SUMMARY:Call with LA')
  );
  const [event] = eventsOn(ics, '2026-10-14');
  assert.equal(iso(event.start), '2026-10-14T19:00:00.000Z'); // noon PT = 3 PM ET
  assert.equal(iso(event.end), '2026-10-14T20:00:00.000Z');
});

test('DST change day (2026-11-01) is 25 hours long and times follow the change', () => {
  const window = dayWindow('2026-11-01', TZ);
  assert.equal(iso(window.start), '2026-11-01T04:00:00.000Z'); // midnight EDT
  assert.equal(iso(window.end), '2026-11-02T05:00:00.000Z'); // midnight EST

  const ics = calendar(
    vevent('walk',
      'DTSTART;TZID=America/New_York:20261025T090000',
      'DTEND;TZID=America/New_York:20261025T100000',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Walk'),
    vevent('late', // 11:30 PM EST, in the 25th hour
      'DTSTART;TZID=America/New_York:20261101T233000',
      'DTEND;TZID=America/New_York:20261101T234500',
      'SUMMARY:Late show'),
    vevent('early', // 12:30 AM the next day
      'DTSTART;TZID=America/New_York:20261102T003000',
      'DTEND;TZID=America/New_York:20261102T010000',
      'SUMMARY:Too late')
  );
  const nov1 = eventsOn(ics, '2026-11-01');
  assert.deepEqual(nov1.map((e) => e.title), ['Walk', 'Late show']);
  assert.equal(iso(nov1[0].start), '2026-11-01T14:00:00.000Z'); // 9 AM EST
  assert.equal(iso(nov1[1].start), '2026-11-02T04:30:00.000Z');
  // The day before is still EDT.
  assert.equal(iso(eventsOn(ics, '2026-10-31')[0].start), '2026-10-31T13:00:00.000Z');
});

test('missing SUMMARY becomes "(No title)"; zero-length event has no end', () => {
  const ics = calendar(
    vevent('untitled', 'DTSTART;TZID=America/New_York:20261014T130000', 'DTEND;TZID=America/New_York:20261014T140000'),
    vevent('reminder', 'DTSTART;TZID=America/New_York:20261014T170000', 'SUMMARY:Take out trash')
  );
  const [untitled, reminder] = eventsOn(ics, '2026-10-14');
  assert.equal(untitled.title, '(No title)');
  assert.equal(untitled.location, null);
  assert.equal(reminder.title, 'Take out trash');
  assert.equal(reminder.end, null);
});

test('sorted: all-day first, then by start time', () => {
  const ics = calendar(
    vevent('c', 'DTSTART;TZID=America/New_York:20261014T183000', 'DTEND;TZID=America/New_York:20261014T200000', 'SUMMARY:Dinner'),
    vevent('a', 'DTSTART;TZID=America/New_York:20261014T080000', 'DTEND;TZID=America/New_York:20261014T090000', 'SUMMARY:Dentist'),
    vevent('b', 'DTSTART;VALUE=DATE:20261014', 'DTEND;VALUE=DATE:20261015', 'SUMMARY:Birthday')
  );
  assert.deepEqual(titlesOn(ics, '2026-10-14'), ['Birthday', 'Dentist', 'Dinner']);
});

test('yearly all-day repeating event (birthday) and an old daily event both expand', () => {
  const ics = calendar(
    vevent('bday',
      'DTSTART;VALUE=DATE:19951014',
      'DTEND;VALUE=DATE:19951015',
      'RRULE:FREQ=YEARLY',
      "SUMMARY:Mom's birthday"),
    vevent('vitamins', // ~9,800 occurrences before today; must still be fast
      'DTSTART;TZID=America/New_York:20000101T073000',
      'DTEND;TZID=America/New_York:20000101T073500',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Vitamins')
  );
  const started = Date.now();
  const today = eventsOn(ics, '2026-10-14');
  assert.deepEqual(today.map((e) => e.title), ["Mom's birthday", 'Vitamins']);
  assert.equal(today[0].allDay, true);
  assert.equal(iso(today[1].start), '2026-10-14T11:30:00.000Z');
  assert.ok(Date.now() - started < 5000, 'expansion should be quick');
});

test('time zone with no VTIMEZONE in the feed, and floating times', () => {
  const ics = calendar(
    // London is on BST (UTC+1) on Oct 14, 2026.
    vevent('london', 'DTSTART;TZID=Europe/London:20261014T170000', 'DTEND;TZID=Europe/London:20261014T180000', 'SUMMARY:London call'),
    // No zone at all = "local time" = the digest's zone.
    vevent('floating', 'DTSTART:20261014T070000', 'DTEND:20261014T080000', 'SUMMARY:Run')
  );
  const today = eventsOn(ics, '2026-10-14');
  assert.deepEqual(today.map((e) => [e.title, iso(e.start)]), [
    ['Run', '2026-10-14T11:00:00.000Z'],
    ['London call', '2026-10-14T16:00:00.000Z'],
  ]);
});

test('rejects text that is not an iCal feed, and a badly formatted day', () => {
  assert.throws(() => getEventsForDay('<html>Not found</html>', '2026-10-14', TZ, OWNER));
  assert.throws(() => getEventsForDay(calendar(), '10/14/2026', TZ, OWNER));
});

test('day helpers', () => {
  // 11:30 PM ET on Oct 14 is already Oct 15 in UTC.
  assert.equal(dateKeyInTimeZone(new Date('2026-10-15T03:30:00Z'), TZ), '2026-10-14');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  const spring = dayWindow('2026-03-08', TZ); // 23-hour day
  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 3600 * 1000);
});

test('redactSecret removes the calendar URL (and its secret path) from messages', () => {
  const url = 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics';
  assert.equal(redactSecret(`GET ${url} failed`, url), 'GET [calendar URL] failed');
  assert.equal(
    redactSecret('404 at /calendar/ical/me%40gmail.com/private-abc123/basic.ics', url),
    '404 at [calendar URL]'
  );
  assert.equal(redactSecret('timeout of 15000ms exceeded', undefined), 'timeout of 15000ms exceeded');
});
