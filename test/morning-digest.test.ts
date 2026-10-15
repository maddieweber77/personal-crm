import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildMorningDigest } from '../src/services/morning-digest';
import { runMorningDigest } from '../src/services/morning-digest-job';
import type { CalendarEvent } from '../src/services/calendar';
import { calendar, vevent } from './ics-fixtures';

const DATE = '2026-10-14'; // a Wednesday; New York is UTC-4 that day

function timed(title: string, startIso: string, endIso: string | null, location: string | null = null): CalendarEvent {
  return { title, start: new Date(startIso), end: endIso ? new Date(endIso) : null, allDay: false, location };
}

function allDay(title: string, firstDay: string, dayAfterLast: string): CalendarEvent {
  // Midnight New York time (04:00 UTC in October).
  return { title, start: new Date(`${firstDay}T04:00:00Z`), end: new Date(`${dayAfterLast}T04:00:00Z`), allDay: true, location: null };
}

const TYPICAL_DAY: CalendarEvent[] = [
  allDay("Sarah's birthday", '2026-10-14', '2026-10-15'),
  timed('Dentist', '2026-10-14T12:00:00Z', '2026-10-14T13:00:00Z', 'Main St Dental'),
  timed('Dinner with Grace', '2026-10-14T22:30:00Z', '2026-10-15T00:00:00Z'),
];

test('SMS lists the day in New York time, all-day first', () => {
  const digest = buildMorningDigest({ date: DATE, calendar: { status: 'ok', events: TYPICAL_DAY } });
  assert.equal(
    digest.sms,
    [
      'Good morning! Wed Oct 14:',
      "• All day: Sarah's birthday",
      '• 8:00 AM Dentist (Main St Dental)',
      '• 6:30 PM Dinner with Grace',
    ].join('\n')
  );
});

test('email has every event with end times and locations', () => {
  const digest = buildMorningDigest({ date: DATE, calendar: { status: 'ok', events: TYPICAL_DAY } });
  assert.equal(digest.emailSubject, 'Morning digest: Wed Oct 14 - 3 events');
  assert.match(digest.emailText, /^Good morning! Here's Wednesday, October 14\./);
  assert.match(digest.emailText, /• All day: Sarah's birthday/);
  assert.match(digest.emailText, /• 8:00 AM – 9:00 AM: Dentist\n {4}Where: Main St Dental/);
  assert.match(digest.emailText, /• 6:30 PM – 8:00 PM: Dinner with Grace/);
});

test('empty day says so', () => {
  const digest = buildMorningDigest({ date: DATE, calendar: { status: 'ok', events: [] } });
  assert.equal(digest.sms, 'Good morning! Wed Oct 14:\nNothing on your personal calendar today.');
  assert.match(digest.emailText, /Nothing on your personal calendar today\./);
  assert.equal(digest.emailSubject, 'Morning digest: Wed Oct 14 - nothing on the calendar');
});

test('failed calendar load says so and never claims an empty day', () => {
  const digest = buildMorningDigest({ date: DATE, calendar: { status: 'failed' } });
  const message = "Couldn't load your calendar this morning — check it manually.";
  assert.ok(digest.sms.includes(message));
  assert.ok(digest.emailText.includes(message));
  assert.ok(!digest.sms.includes('Nothing on'));
  assert.ok(!digest.emailText.includes('Nothing on'));
  assert.match(digest.emailSubject, /calendar didn't load/);
});

test('missing calendar URL says the calendar is not connected', () => {
  const digest = buildMorningDigest({ date: DATE, calendar: { status: 'not_configured' } });
  assert.match(digest.sms, /calendar isn't connected yet/);
  assert.match(digest.emailText, /PERSONAL_CALENDAR_ICS_URL/);
  assert.ok(!digest.sms.includes('Nothing on'));
});

test('more than 8 events: SMS shows 8 then "+N more", email shows all', () => {
  const events = Array.from({ length: 12 }, (_, i) =>
    timed(`Event ${i + 1}`, `2026-10-14T${String(12 + i).padStart(2, '0')}:00:00Z`, null)
  );
  const digest = buildMorningDigest({ date: DATE, calendar: { status: 'ok', events } });
  const lines = digest.sms.split('\n');
  assert.equal(lines.filter((line) => line.startsWith('• ')).length, 8);
  assert.equal(lines[lines.length - 1], '+4 more (see email)');
  assert.equal(digest.emailText.split('\n').filter((line) => line.startsWith('• ')).length, 12);
});

test('SMS stays under 600 chars and cuts long titles/locations', () => {
  const longTitle = 'Quarterly planning offsite with the whole extended team '.repeat(4);
  const longPlace = 'The Very Long Conference Center Name, 1234 Some Avenue, Suite 500, New York, NY';
  const events = Array.from({ length: 30 }, (_, i) =>
    timed(`${longTitle}${i}`, `2026-10-14T${String(10 + (i % 12)).padStart(2, '0')}:00:00Z`, null, longPlace)
  );
  const digest = buildMorningDigest({ date: DATE, calendar: { status: 'ok', events } });
  assert.ok(digest.sms.length <= 600, `SMS was ${digest.sms.length} chars`);
  assert.ok(digest.sms.includes('…'), 'long text should be cut with …');
  assert.match(digest.sms.split('\n').pop() ?? '', /^\+\d+ more \(see email\)$/);
  // The email keeps everything, uncut.
  assert.ok(digest.emailText.includes(`${longTitle.trim()}29`) || digest.emailText.includes(`${longTitle}29`));
  assert.ok(digest.emailText.includes(longPlace));
});

test('overnight event from yesterday and multi-day all-day event', () => {
  const events = [
    allDay('Ski trip', '2026-10-13', '2026-10-17'),
    timed('Red-eye flight', '2026-10-14T02:00:00Z', '2026-10-14T06:00:00Z'), // Tue 10 PM -> Wed 2 AM ET
    timed('Take out trash', '2026-10-14T21:00:00Z', null),
  ];
  const digest = buildMorningDigest({ date: DATE, calendar: { status: 'ok', events } });
  assert.ok(digest.sms.includes('• All day: Ski trip'));
  assert.ok(digest.sms.includes('• Until 2:00 AM Red-eye flight'));
  assert.ok(digest.sms.includes('• 5:00 PM Take out trash'));
  assert.ok(digest.emailText.includes('• All day (Tue Oct 13 – Fri Oct 16): Ski trip'));
  assert.ok(digest.emailText.includes('• Tue 10:00 PM – 2:00 AM: Red-eye flight'));
  assert.ok(digest.emailText.includes('• 5:00 PM: Take out trash'));
});

// --- The job in dry-run mode: real parsing, no network, no database. ---

let dir: string;
let savedUrl: string | undefined;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'digest-test-'));
  savedUrl = process.env.PERSONAL_CALENDAR_ICS_URL;
  delete process.env.PERSONAL_CALENDAR_ICS_URL;
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  if (savedUrl !== undefined) process.env.PERSONAL_CALENDAR_ICS_URL = savedUrl;
});

test('dry run with a local .ics file builds the digest (LA time shown in Eastern)', async () => {
  const file = join(dir, 'calendar.ics');
  await writeFile(file, calendar(
    vevent('la',
      'DTSTART;TZID=America/Los_Angeles:20261014T120000',
      'DTEND;TZID=America/Los_Angeles:20261014T130000',
      'SUMMARY:Call with LA')
  ));
  const result = await runMorningDigest({ dryRun: true, icsFile: file, date: DATE });
  assert.equal(result.outcome, 'preview');
  assert.ok(result.outcome === 'preview' && result.digest.sms.includes('• 3:00 PM Call with LA'));
});

test('dry run with no calendar URL says not connected', async () => {
  const result = await runMorningDigest({ dryRun: true, date: DATE });
  assert.ok(result.outcome === 'preview' && result.digest.sms.includes("isn't connected"));
});

test('dry run with an unreadable calendar reports the failure', async () => {
  const result = await runMorningDigest({ dryRun: true, icsFile: join(dir, 'missing.ics'), date: DATE });
  assert.ok(result.outcome === 'preview' && result.digest.sms.includes("Couldn't load your calendar"));
});
