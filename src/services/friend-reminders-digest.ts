/**
 * "Text them" reminders for the morning digest. Pure: no DB, no network.
 *
 * - Birthdays: 2 weeks ahead, the day before, and the day of.
 * - Other dated things people mentioned (interview, surgery, wedding, trip...):
 *   the day before and the day of.
 */

/** Apple Contacts stores "no year" birthdays with the year 1604. */
export const NO_YEAR = 1604;
export const BIRTHDAY_HEADS_UP_DAYS = 14;

export interface BirthdayInput {
  name: string;
  birthday: string; // YYYY-MM-DD (year 1604 = year unknown)
}

export interface DatedEventInput {
  name: string;
  description: string;
  eventType: string;
  date: string; // YYYY-MM-DD
}

export interface FriendReminder {
  daysAway: number; // 0 today, 1 tomorrow, 14 two weeks
  kind: 'birthday' | 'event';
  text: string;
}

function parseDay(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from), b = parseDay(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Next birthday on or after `today`. Feb 29 birthdays fall on Feb 28 in other years. */
export function nextBirthday(birthday: string, today: string): { date: string; turning: number | null } {
  const b = parseDay(birthday), t = parseDay(today);
  for (const year of [t.y, t.y + 1]) {
    const day = b.m === 2 && b.d === 29 && !isLeapYear(year) ? 28 : b.d;
    const date = iso(year, b.m, day);
    if (daysBetween(today, date) >= 0) {
      return { date, turning: b.y === NO_YEAR ? null : year - b.y };
    }
  }
  throw new Error('unreachable');
}

function whenWords(daysAway: number, date: string): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `In 2 weeks (${weekday})`;
}

export function friendReminders(today: string, birthdays: BirthdayInput[], events: DatedEventInput[]): FriendReminder[] {
  const reminders: FriendReminder[] = [];
  const seenBirthdays = new Set<string>();

  for (const person of birthdays) {
    const key = person.name.toLowerCase();
    if (seenBirthdays.has(key)) continue; // same person listed twice
    const next = nextBirthday(person.birthday, today);
    const daysAway = daysBetween(today, next.date);
    if (daysAway !== 0 && daysAway !== 1 && daysAway !== BIRTHDAY_HEADS_UP_DAYS) continue;
    seenBirthdays.add(key);
    const age = next.turning && next.turning > 0 && next.turning < 120 ? ` (turns ${next.turning})` : '';
    const nudge = daysAway === 0 ? ': send a text!' : daysAway === BIRTHDAY_HEADS_UP_DAYS ? ': time to plan a card or gift' : '';
    reminders.push({ daysAway, kind: 'birthday', text: `${whenWords(daysAway, next.date)}: ${person.name}'s birthday${age}${nudge}` });
  }

  for (const event of events) {
    const daysAway = daysBetween(today, event.date);
    if (daysAway !== 0 && daysAway !== 1) continue;
    const nudge = daysAway === 0 ? ': text to wish them luck / check in' : '';
    reminders.push({ daysAway, kind: 'event', text: `${whenWords(daysAway, event.date)}: ${event.name}: ${event.description}${nudge}` });
  }

  // Soonest first; birthdays before other events on the same day.
  return reminders.sort((a, b) => a.daysAway - b.daysAway || (a.kind === b.kind ? 0 : a.kind === 'birthday' ? -1 : 1));
}

export interface PersonToSee {
  name: string;
  lastSeen: string | null; // YYYY-MM-DD
  latestUpdate: string | null;
}

/** "Liv Cleary (last saw Sep 2): Moved 10 minutes away" for the Monday "make a plan" list. */
export function seeSuggestionLines(today: string, people: PersonToSee[]): string[] {
  return people.map(p => {
    const when = p.lastSeen
      ? `last saw ${new Date(`${p.lastSeen}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${Math.round(daysBetween(p.lastSeen, today) / 7)} wks ago`
      : 'no recent hangout on record';
    const latest = p.latestUpdate ? `: ${p.latestUpdate.length > 90 ? p.latestUpdate.slice(0, 87) + '...' : p.latestUpdate}` : '';
    return `• ${p.name} (${when})${latest}`;
  });
}

/** Monday? (the "make a plan" list only comes once a week) */
export function isMonday(date: string): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 1;
}
