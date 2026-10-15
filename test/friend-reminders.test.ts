import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendReminders, nextBirthday, daysBetween } from '../src/services/friend-reminders-digest';
import { buildMorningDigest } from '../src/services/morning-digest';

const TODAY = '2026-10-15';

test('birthdays remind 2 weeks ahead, the day before and the day of only', () => {
  const r = friendReminders(TODAY, [
    { name: 'Sarah Kim', birthday: '1996-10-15' }, // today, turns 30
    { name: 'Grace Pickett', birthday: '1604-10-16' }, // tomorrow, no year
    { name: 'Mike Lee', birthday: '1995-10-29' }, // in 14 days
    { name: 'Priya Shah', birthday: '1995-10-20' }, // 5 days: no reminder
  ], []);
  assert.deepEqual(r.map(x => x.text), [
    "Today: Sarah Kim's birthday (turns 30): send a text!",
    "Tomorrow: Grace Pickett's birthday",
    "In 2 weeks (Thu, Oct 29): Mike Lee's birthday (turns 31): time to plan a card or gift",
  ]);
});

test('birthdays wrap into next year', () => {
  assert.equal(nextBirthday('1990-01-03', '2026-12-20').date, '2027-01-03');
  assert.equal(daysBetween('2026-12-20', '2027-01-03'), 14);
  assert.equal(friendReminders('2026-12-20', [{ name: 'Ann', birthday: '1990-01-03' }], [])[0].daysAway, 14);
});

test('Feb 29 birthdays land on Feb 28 in other years', () => {
  assert.equal(nextBirthday('2000-02-29', '2027-02-01').date, '2027-02-28');
  assert.equal(nextBirthday('2000-02-29', '2028-02-01').date, '2028-02-29');
});

test('the same person listed twice gets one reminder', () => {
  const r = friendReminders(TODAY, [{ name: 'Sarah Kim', birthday: '1996-10-15' }, { name: 'sarah kim', birthday: '1996-10-15' }], []);
  assert.equal(r.length, 1);
});

test('other events remind the day before and the day of', () => {
  const r = friendReminders(TODAY, [], [
    { name: 'Sarah Kim', description: 'Job interview at Google', eventType: 'interview', date: '2026-10-16' },
    { name: 'Mom', description: 'Knee surgery', eventType: 'surgery', date: '2026-10-15' },
    { name: 'Bob', description: 'Trip to Italy', eventType: 'trip', date: '2026-10-20' },
  ]);
  assert.deepEqual(r.map(x => x.text), [
    'Today: Mom: Knee surgery: text to wish them luck / check in',
    'Tomorrow: Sarah Kim: Job interview at Google',
  ]);
});

test('digest puts friend reminders first, and leaves the section out when empty', () => {
  const calendar = { status: 'ok' as const, events: [] };
  const withFriends = buildMorningDigest({ date: TODAY, calendar, friends: { status: 'ok', reminders: friendReminders(TODAY, [{ name: 'Sarah Kim', birthday: '1996-10-15' }], []) } });
  assert.match(withFriends.sms, /^Good morning! Thu Oct 15:\n• Today: Sarah Kim's birthday/);
  assert.match(withFriends.emailText, /TEXT THEM\n• Today: Sarah Kim's birthday/);
  assert.match(withFriends.emailSubject, /1 friend reminder/);

  const quiet = buildMorningDigest({ date: TODAY, calendar, friends: { status: 'ok', reminders: [] } });
  assert.doesNotMatch(quiet.emailText, /TEXT THEM/);

  const failed = buildMorningDigest({ date: TODAY, calendar, friends: { status: 'failed' } });
  assert.match(failed.sms, /Couldn't load birthday\/friend reminders/);
});

test('Monday digest suggests people to see, email only', async () => {
  const { seeSuggestionLines, isMonday } = await import('../src/services/friend-reminders-digest');
  assert.equal(isMonday('2026-10-19'), true);
  assert.equal(isMonday('2026-10-15'), false);
  const toSee = [{ name: 'Liv Cleary', lastSeen: '2026-09-07', latestUpdate: 'Moved 10 minutes away' }, { name: 'Katie Weber', lastSeen: null, latestUpdate: null }];
  assert.deepEqual(seeSuggestionLines('2026-10-19', toSee), [
    '• Liv Cleary (last saw Sep 7, 6 wks ago): Moved 10 minutes away',
    '• Katie Weber (no recent hangout on record)',
  ]);
  const digest = buildMorningDigest({ date: '2026-10-19', calendar: { status: 'ok', events: [] }, friends: { status: 'ok', reminders: [], toSee } });
  assert.match(digest.emailText, /MAKE A PLAN THIS WEEK/);
  assert.doesNotMatch(digest.sms, /Liv Cleary/);
});
