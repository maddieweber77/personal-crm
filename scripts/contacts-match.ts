/**
 * Match CRM people to the Mac Contacts app (run on Maddie's laptop).
 *
 *   npx tsx scripts/contacts-match.ts                 # report only: changes nothing
 *   npx tsx scripts/contacts-match.ts --apply         # save exact matches (phones, full name, birthday)
 *   npx tsx scripts/contacts-match.ts --apply --include-likely   # also first-name-only matches
 *   npx tsx scripts/contacts-match.ts --duplicates    # list likely duplicate people to merge
 *   npx tsx scripts/contacts-match.ts --merge <keepId> <duplicateId>
 *
 * The report has names and phone numbers, so it's written outside the repo
 * (--out <path>, default: your temp folder). Needs DATABASE_URL, and the
 * terminal needs access to Contacts (macOS asks the first time).
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  toE164, appleDateToIso, contactFullName, matchPerson, findDuplicatePairs, type Contact,
} from '../src/services/contacts';
import { getPeopleForMatching, setContactInfo, mergePeople, closePool } from '../src/database/client';

function addressBookFiles(): string[] {
  const root = join(homedir(), 'Library/Application Support/AddressBook');
  const files = [join(root, 'AddressBook-v22.abcddb')];
  const sources = join(root, 'Sources');
  if (existsSync(sources)) {
    for (const dir of readdirSync(sources)) files.push(join(sources, dir, 'AddressBook-v22.abcddb'));
  }
  return files.filter(f => existsSync(f));
}

function readContacts(): Contact[] {
  const contacts: Contact[] = [];
  for (const file of addressBookFiles()) {
    const db = new DatabaseSync(file, { readOnly: true });
    const people = db.prepare(
      `SELECT Z_PK AS pk, ZFIRSTNAME AS first, ZLASTNAME AS last, ZNICKNAME AS nick, ZBIRTHDAY AS bday
       FROM ZABCDRECORD WHERE ZFIRSTNAME IS NOT NULL OR ZLASTNAME IS NOT NULL`
    ).all() as Array<{ pk: number; first: string | null; last: string | null; nick: string | null; bday: number | null }>;
    const phones = db.prepare(`SELECT ZOWNER AS owner, ZFULLNUMBER AS number FROM ZABCDPHONENUMBER`).all() as Array<{ owner: number; number: string | null }>;
    const byOwner = new Map<number, string[]>();
    for (const p of phones) {
      const e164 = p.number ? toE164(p.number) : null;
      if (e164) byOwner.set(p.owner, [...(byOwner.get(p.owner) || []), e164]);
    }
    for (const r of people) {
      contacts.push({
        firstName: r.first, lastName: r.last, nickname: r.nick,
        phones: [...new Set(byOwner.get(r.pk) || [])],
        birthday: appleDateToIso(r.bday),
      });
    }
    db.close();
  }
  return contacts;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--merge')) {
    const keep = arg('--merge');
    const dup = process.argv[process.argv.indexOf('--merge') + 2];
    if (!keep || !dup) throw new Error('Usage: --merge <keepId> <duplicateId>');
    const { moved } = await mergePeople(keep, dup);
    console.log('Merged. Moved:', moved);
    return;
  }

  const people = await getPeopleForMatching();

  if (process.argv.includes('--duplicates')) {
    const pairs = findDuplicatePairs(people);
    console.log(pairs.length ? 'Likely duplicates (keep the first, merge the second):' : 'No likely duplicates.');
    for (const [a, b] of pairs) console.log(`  ${a.name} (${a.id})  <-  ${b.name} (${b.id})`);
    return;
  }

  const contacts = readContacts();
  const matches = people.map(p => matchPerson(p, contacts));
  const apply = process.argv.includes('--apply');
  const includeLikely = process.argv.includes('--include-likely');

  const lines = [`# Contacts match (${new Date().toISOString().slice(0, 10)})`, '',
    `${people.length} CRM people, ${contacts.length} contacts.`, ''];
  for (const kind of ['exact', 'likely', 'ambiguous', 'none'] as const) {
    const group = matches.filter(m => m.kind === kind);
    lines.push(`## ${kind} (${group.length})`);
    for (const m of group) {
      if (m.kind === 'exact' || m.kind === 'likely') {
        lines.push(`- ${m.person.name} -> ${contactFullName(m.contact)} | ${m.contact.phones.join(', ') || 'no phone'}${m.contact.birthday ? ` | bday ${m.contact.birthday}` : ''}`);
      } else if (m.kind === 'ambiguous') {
        lines.push(`- ${m.person.name} -> ${m.contacts.length} contacts: ${m.contacts.slice(0, 6).map(contactFullName).join('; ')}`);
      } else {
        lines.push(`- ${m.person.name}`);
      }
    }
    lines.push('');
  }
  const out = arg('--out') || join(tmpdir(), 'personal-crm-contacts-match.md');
  writeFileSync(out, lines.join('\n'));

  const counts = Object.fromEntries(['exact', 'likely', 'ambiguous', 'none'].map(k => [k, matches.filter(m => m.kind === k).length]));
  console.log('Matches:', counts, '\nReport:', out);

  if (!apply) {
    console.log('Report only: nothing was changed. Re-run with --apply to save exact matches.');
    return;
  }
  let saved = 0;
  for (const m of matches) {
    if (m.kind === 'exact' || (includeLikely && m.kind === 'likely')) {
      const full = contactFullName(m.contact);
      await setContactInfo(m.person.id, {
        // Only upgrade a first-name-only CRM name to the full name.
        fullName: !m.person.name.includes(' ') && full.includes(' ') ? full : null,
        phoneNumbers: m.contact.phones,
        birthday: m.contact.birthday,
      });
      saved++;
    }
  }
  console.log(`Saved contact info for ${saved} people.`);
}

main()
  .catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => closePool());
