/**
 * Helpers to build small Google-Calendar-style .ics feeds for tests.
 * (Not a test file itself: the test runner only picks up *.test.ts.)
 */

// Google puts a VTIMEZONE block in the feed for every time zone it uses.
const NEW_YORK = `BEGIN:VTIMEZONE
TZID:America/New_York
X-LIC-LOCATION:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

const LOS_ANGELES = `BEGIN:VTIMEZONE
TZID:America/Los_Angeles
X-LIC-LOCATION:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

/** Wrap VEVENT blocks in a full calendar (CRLF line endings, like Google). */
export function calendar(...vevents: string[]): string {
  const text = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:maddieweber7@gmail.com',
    'X-WR-TIMEZONE:America/New_York',
    NEW_YORK,
    LOS_ANGELES,
    ...vevents,
    'END:VCALENDAR',
  ].join('\n');
  return text.replace(/\r?\n/g, '\r\n');
}

/** One VEVENT. Pass the lines that matter; UID/DTSTAMP/STATUS are filled in. */
export function vevent(uid: string, ...lines: string[]): string {
  const hasStatus = lines.some((line) => line.startsWith('STATUS:'));
  return [
    'BEGIN:VEVENT',
    ...lines,
    'DTSTAMP:20261001T120000Z',
    `UID:${uid}@google.com`,
    ...(hasStatus ? [] : ['STATUS:CONFIRMED']),
    'SEQUENCE:0',
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ].join('\n');
}
