import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMention, newAliases, looksLikeName, parseIsoDate, normalizeName, formatRoster,
  type ExtractedMention, type RosterPerson, type Extraction,
} from '../src/services/person-resolver';
import { processEntry, type PeopleStore } from '../src/services/apply-extraction';
import { planMerge } from '../src/services/merge-plan';
import { pendingMigrations, BASELINE_MIGRATIONS } from '../src/database/migrate';

const SARAH_KIM: RosterPerson = { id: 'p-sarah-kim', name: 'Sarah Kim', aliases: [], relationship: 'friend', recent: ['Moved to Denver'] };
const SARAH: RosterPerson = { id: 'p-sarah', name: 'Sarah', aliases: [], relationship: 'coworker', recent: [] };
const GRACE: RosterPerson = { id: 'p-grace', name: 'Grace Smith', aliases: ['Gracie'], relationship: 'friend', recent: [] };

function mention(over: Partial<ExtractedMention>): ExtractedMention {
  return {
    mention: 'Someone', match: 'new', person_id: null, candidate_ids: [], full_name: null, aliases: [],
    relationship: 'friend', interacted: false, saw_in_person: null, updates: [], events: [], situations: [], ...over,
  };
}

// ---------- resolveMention ----------

test('existing match with a real roster id is accepted', () => {
  assert.deepEqual(
    resolveMention(mention({ mention: 'Sarah', match: 'existing', person_id: SARAH_KIM.id }), [SARAH_KIM, GRACE]),
    { kind: 'existing', personId: SARAH_KIM.id }
  );
});

test('existing match with a made-up id never writes to a random person', () => {
  const r = resolveMention(mention({ mention: 'Sarah', match: 'existing', person_id: 'not-a-real-id' }), [SARAH_KIM, SARAH]);
  assert.deepEqual(r, { kind: 'unsure', candidateIds: [SARAH_KIM.id, SARAH.id] });
});

test('"new" Sarah is held back when a Sarah already exists (no silent duplicate)', () => {
  const r = resolveMention(mention({ mention: 'Sarah', match: 'new' }), [SARAH_KIM, GRACE]);
  assert.deepEqual(r, { kind: 'unsure', candidateIds: [SARAH_KIM.id] });
});

test('"new" Sarah Lee is fine when every saved Sarah has a different last name', () => {
  const r = resolveMention(mention({ mention: 'Sarah Lee', full_name: 'Sarah Lee', match: 'new' }), [SARAH_KIM]);
  assert.deepEqual(r, { kind: 'new', name: 'Sarah Lee' });
});

test('"new" Sarah Lee is held back when a last-name-less "Sarah" exists (could be her)', () => {
  const r = resolveMention(mention({ mention: 'Sarah Lee', full_name: 'Sarah Lee', match: 'new' }), [SARAH]);
  assert.deepEqual(r, { kind: 'unsure', candidateIds: [SARAH.id] });
});

test('a nickname matching a saved alias counts as a lookalike', () => {
  const r = resolveMention(mention({ mention: 'Gracie', match: 'new' }), [GRACE]);
  assert.deepEqual(r, { kind: 'unsure', candidateIds: [GRACE.id] });
});

test('unsure keeps only real candidate ids', () => {
  const r = resolveMention(mention({ mention: 'Sarah', match: 'unsure', candidate_ids: [SARAH.id, 'fake'] }), [SARAH, SARAH_KIM]);
  assert.deepEqual(r, { kind: 'unsure', candidateIds: [SARAH.id] });
});

test('unsure with no candidates but a real name becomes a new person', () => {
  const r = resolveMention(mention({ mention: 'Priya', match: 'unsure' }), [SARAH, GRACE]);
  assert.deepEqual(r, { kind: 'new', name: 'Priya' });
});

test('a description with no name ("my sister\'s boyfriend") is never saved as a person', () => {
  assert.deepEqual(resolveMention(mention({ mention: "my sister's boyfriend", match: 'new' }), []), { kind: 'unsure', candidateIds: [] });
  assert.deepEqual(resolveMention(mention({ mention: "my sister's boyfriend", match: 'unsure' }), []), { kind: 'unsure', candidateIds: [] });
});

test('brand-new name on an empty roster is created', () => {
  assert.deepEqual(resolveMention(mention({ mention: 'Mike', match: 'new' }), []), { kind: 'new', name: 'Mike' });
});

// ---------- small helpers ----------

test('newAliases learns nicknames but not a bare first name', () => {
  assert.deepEqual(newAliases(mention({ mention: 'Gigi', aliases: ['Gracie', 'G-money'] }), GRACE), ['Gigi', 'G-money']);
  assert.deepEqual(newAliases(mention({ mention: 'Grace' }), GRACE), []);
  assert.deepEqual(newAliases(mention({ mention: 'my friend' }), GRACE), []);
});

test('looksLikeName / normalizeName', () => {
  assert.equal(looksLikeName('Mom'), true);
  assert.equal(looksLikeName('Dr. Patel'), true);
  assert.equal(looksLikeName('the barista'), false);
  assert.equal(looksLikeName(''), false);
  assert.equal(normalizeName("  Zoë O'Neil "), 'zoe oneil');
});

test('parseIsoDate only accepts real YYYY-MM-DD dates', () => {
  assert.equal(parseIsoDate('2026-03-15')?.toISOString().slice(0, 10), '2026-03-15');
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('next Tuesday'), null);
  assert.equal(parseIsoDate(null), null);
});

test('formatRoster gives ids and context, and handles an empty roster', () => {
  assert.match(formatRoster([SARAH_KIM]), /^p-sarah-kim \| Sarah Kim \| friend \| recent: "Moved to Denver"$/);
  assert.match(formatRoster([GRACE]), /aka Gracie/);
  assert.match(formatRoster([]), /empty/);
});

// ---------- processEntry with a fake database ----------

function fakeStore(roster: RosterPerson[]) {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string) => async (...args: unknown[]) => { (calls[name] ||= []).push(args); };
  const store: PeopleStore = {
    getRoster: async () => roster.map(p => ({ ...p })),
    createPerson: async (name) => { (calls.createPerson ||= []).push([name]); return { id: `new-${name}`, name }; },
    addAliases: record('addAliases') as PeopleStore['addAliases'],
    createPersonUpdate: record('createPersonUpdate'),
    updateLastContactDate: record('updateLastContactDate') as PeopleStore['updateLastContactDate'],
    updateLastSeenDate: record('updateLastSeenDate') as PeopleStore['updateLastSeenDate'],
    createFriendEvent: record('createFriendEvent'),
    createFriendSituation: record('createFriendSituation'),
    createPendingMention: record('createPendingMention'),
  };
  return { store, calls };
}

const fakeExtract = (people: ExtractedMention[]) => async (): Promise<Extraction> => ({ people });

test('processEntry: matched, new and unsure people each go to the right place', async () => {
  const { store, calls } = fakeStore([SARAH_KIM, SARAH, GRACE]);
  const result = await processEntry('transcript', { kind: 'voice', entryId: 'v1' }, new Date('2026-10-14T23:00:00Z'), store, fakeExtract([
    mention({ mention: 'Gigi', match: 'existing', person_id: GRACE.id, interacted: true, updates: [{ update_text: 'Got engaged', context: null }] }),
    mention({ mention: 'Sarah', match: 'unsure', candidate_ids: [SARAH.id, SARAH_KIM.id], updates: [{ update_text: 'Has an interview', context: null }] }),
    mention({ mention: 'Priya', match: 'new', events: [{ event_type: 'birthday', event_description: "Priya's birthday", event_date: '2026-11-02', event_date_approximate: null }] }),
  ]));

  assert.deepEqual(result, { matched: ['Grace Smith'], created: ['Priya'], pending: ['Sarah'] });
  // Only Grace was "seen", so only Grace's last-contact date moves.
  assert.deepEqual(calls.updateLastContactDate.map(c => c[0]), [GRACE.id]);
  assert.deepEqual(calls.addAliases, [[GRACE.id, ['Gigi']]]);
  // Sarah's interview is parked, not written to either Sarah.
  assert.equal(calls.createPersonUpdate.length, 1);
  assert.equal(calls.createPersonUpdate[0][0], GRACE.id);
  assert.deepEqual(calls.createPersonUpdate[0][1], { voiceEntryId: 'v1', manualEntryId: null });
  assert.deepEqual(calls.createPendingMention[0].slice(0, 2), ['Sarah', [SARAH.id, SARAH_KIM.id]]);
  // Birthday saved on the new person, as a recurring event.
  assert.equal(calls.createFriendEvent[0][0], 'new-Priya');
  assert.equal(calls.createFriendEvent[0][5], true);
});

test('processEntry: texted notes link updates to the manual entry, not a call', async () => {
  const { store, calls } = fakeStore([GRACE]);
  await processEntry('note', { kind: 'manual', entryId: 'm1' }, new Date(), store, fakeExtract([
    mention({ mention: 'Grace', match: 'existing', person_id: GRACE.id, updates: [{ update_text: 'Loves matcha', context: null }] }),
  ]));
  assert.deepEqual(calls.createPersonUpdate[0][1], { voiceEntryId: null, manualEntryId: 'm1' });
});

test('processEntry: the same new person mentioned twice is created once', async () => {
  const { store, calls } = fakeStore([]);
  await processEntry('t', { kind: 'voice', entryId: 'v1' }, new Date(), store, fakeExtract([
    mention({ mention: 'Priya', match: 'new' }),
    mention({ mention: 'Priya', match: 'new' }),
  ]));
  assert.equal(calls.createPerson.length, 1);
  assert.equal(calls.createPendingMention.length, 1); // second one sees the first and asks
});

test('processEntry: an unparseable event date is kept as approximate timing', async () => {
  const { store, calls } = fakeStore([GRACE]);
  await processEntry('t', { kind: 'voice', entryId: 'v1' }, new Date(), store, fakeExtract([
    mention({ mention: 'Grace', match: 'existing', person_id: GRACE.id,
      events: [{ event_type: 'trip', event_description: 'Italy trip', event_date: 'early June', event_date_approximate: null }] }),
  ]));
  assert.equal(calls.createFriendEvent[0][3], null);
  assert.equal(calls.createFriendEvent[0][4], 'early June');
});

// ---------- merges ----------

test('planMerge keeps everything from both people', () => {
  const merged = planMerge(
    { id: 'a', name: 'Sarah Kim', aliases: ['SK'], relationship: 'friend', priority_level: 'normal', last_contact_date: new Date('2026-01-01'), phone_numbers: ['+17045550001'], birthday: null },
    { id: 'b', name: 'Sarah', aliases: ['sk', 'Sare'], relationship: 'unknown', priority_level: 'high', last_contact_date: new Date('2026-02-01'), phone_numbers: ['+17045550001', '+19175550002'], birthday: new Date('1995-05-05') },
  );
  assert.deepEqual(merged.aliases, ['SK', 'Sarah', 'Sare']);
  assert.equal(merged.relationship, 'friend');
  assert.equal(merged.priority_level, 'high');
  assert.equal(merged.last_contact_date?.toISOString().slice(0, 10), '2026-02-01');
  assert.deepEqual(merged.phone_numbers, ['+17045550001', '+19175550002']);
  assert.equal(merged.birthday?.toISOString().slice(0, 10), '1995-05-05');
});

// ---------- migrations ----------

test('migrations: baseline files never re-run; new ones run in order', () => {
  const files = ['006_person_identity.sql', '001_create_tables.sql', '005_digest_log.sql', 'README.md', ...BASELINE_MIGRATIONS];
  assert.deepEqual(pendingMigrations(files, new Set(BASELINE_MIGRATIONS)), ['005_digest_log.sql', '006_person_identity.sql']);
  assert.deepEqual(pendingMigrations(files, new Set([...BASELINE_MIGRATIONS, '005_digest_log.sql', '006_person_identity.sql'])), []);
});

test('possessive descriptions are not names', () => {
  assert.equal(looksLikeName("Davis's little brother"), false);
  assert.equal(looksLikeName("Fleming’s mom"), false);
  assert.equal(looksLikeName("O'Neil"), true);
});

test('text conversations skip passing first-name mentions and nameless ones', async () => {
  const { store, calls } = fakeStore([GRACE]);
  const res = await processEntry('t', { kind: 'manual', entryId: 'm1', isConversation: true, participants: ['Liv Cleary'] }, new Date('2026-10-14T12:00:00Z'), store, fakeExtract([
    mention({ mention: 'Daniel', match: 'new' }),
    mention({ mention: 'Liv Cleary', full_name: 'Liv Cleary', match: 'new', saw_in_person: '2026-10-02' }),
    mention({ mention: 'Victoria Litz', full_name: 'Victoria Litz', match: 'new' }),
    mention({ mention: 'ur dad', match: 'unsure' }),
  ]));
  assert.deepEqual(res.created, ['Liv Cleary', 'Victoria Litz']);
  assert.equal(calls.createPendingMention, undefined);
  assert.deepEqual(calls.updateLastSeenDate, [['new-Liv Cleary', '2026-10-02']]);
});
