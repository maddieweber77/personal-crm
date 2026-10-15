import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toE164, appleDateToIso, matchPerson, findDuplicatePairs, type Contact } from '../src/services/contacts';

const c = (first: string | null, last: string | null, over: Partial<Contact> = {}): Contact =>
  ({ firstName: first, lastName: last, nickname: null, phones: ['+17045550000'], birthday: null, ...over });

test('toE164 normalizes US numbers and keeps international ones', () => {
  assert.equal(toE164('(704) 555-1234'), '+17045551234');
  assert.equal(toE164('1-704-555-1234'), '+17045551234');
  assert.equal(toE164('+44 20 7946 0958'), '+442079460958');
  assert.equal(toE164('55512'), null); // short code
});

test('appleDateToIso converts Apple timestamps', () => {
  assert.equal(appleDateToIso(0), '2001-01-01');
  assert.equal(appleDateToIso(null), null);
});

test('matchPerson: exact full name, unique first name, ambiguous, none', () => {
  const contacts = [c('Grace', 'Smith'), c('Sarah', 'Kim'), c('Sarah', 'Lee'), c('Priya', 'Shah'), c('Bob', null, { nickname: 'Bobby' })];
  assert.equal(matchPerson({ id: '1', name: 'Grace Smith', aliases: [] }, contacts).kind, 'exact');
  assert.equal(matchPerson({ id: '2', name: 'Priya', aliases: [] }, contacts).kind, 'likely');
  const sarah = matchPerson({ id: '3', name: 'Sarah', aliases: [] }, contacts);
  assert.equal(sarah.kind, 'ambiguous');
  assert.equal(matchPerson({ id: '4', name: 'Zed', aliases: [] }, contacts).kind, 'none');
  assert.equal(matchPerson({ id: '5', name: 'Robert', aliases: ['Bobby'] }, contacts).kind, 'exact');
  // An alias can pin the right Sarah.
  const viaAlias = matchPerson({ id: '6', name: 'Sarah', aliases: ['Sarah Kim'] }, contacts);
  assert.equal(viaAlias.kind, 'exact');
});

test('findDuplicatePairs: first-name-only vs full name, same full name, shared alias', () => {
  const pairs = findDuplicatePairs([
    { id: 'a', name: 'Sarah Kim', aliases: [] },
    { id: 'b', name: 'Sarah', aliases: [] },
    { id: 'c', name: 'Sarah Lee', aliases: [] },
    { id: 'd', name: 'Grace', aliases: ['Gracie'] },
    { id: 'e', name: 'G Smith', aliases: ['gracie'] },
  ]).map(([x, y]) => `${x.id}-${y.id}`);
  assert.deepEqual(pairs, ['a-b', 'b-c', 'd-e']); // Sarah Kim vs Sarah Lee is NOT a pair
});
