/**
 * Pull friends' birthdays from Mac Contacts into the CRM (run on the laptop).
 *
 *   npx tsx scripts/sync-birthdays.ts           # report only: changes nothing
 *   npx tsx scripts/sync-birthdays.ts --apply   # save them
 *
 * "Friends" = contacts with a birthday whom Maddie texted one-on-one in the
 * last 6 months (5+ messages, at least one from her). Matches existing people
 * by phone number, then by exact name; anyone else is added as a new person.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { readContacts, recentTextingPartners } from './lib/mac-data';
import { contactFullName } from '../src/services/contacts';
import { findPersonByPhones, findPersonByExactName, setContactInfo, createPersonFromContact, closePool } from '../src/database/client';

async function main() {
  const apply = process.argv.includes('--apply');
  const partners = recentTextingPartners();
  const friends = readContacts().filter(c => c.birthday && contactFullName(c) && c.phones.some(p => partners.has(p)));

  let updated = 0, added = 0;
  for (const c of friends) {
    const name = contactFullName(c);
    const existing = (await findPersonByPhones(c.phones)) || (await findPersonByExactName(name));
    if (apply) {
      if (existing) await setContactInfo(existing.id, { fullName: null, phoneNumbers: c.phones, birthday: c.birthday });
      else await createPersonFromContact(name, c.phones, c.birthday);
    }
    if (existing) updated++; else added++;
  }
  console.log(`${partners.size} people texted 1:1 in 6 months; ${friends.length} of them have a birthday in Contacts.`);
  console.log(`${apply ? 'Saved' : 'Would save'}: ${updated} existing people updated, ${added} added.`);
  if (!apply) console.log('Report only: nothing was changed. Re-run with --apply to save.');
}

main()
  .catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => closePool());
