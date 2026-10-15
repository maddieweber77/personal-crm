/**
 * Read-only access to this Mac's Contacts and Messages databases.
 * Only for scripts that run on Maddie's laptop (the server has neither).
 * The terminal needs Full Disk Access (System Settings > Privacy & Security).
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toE164, appleDateToIso, type Contact } from '../../src/services/contacts';

function addressBookFiles(): string[] {
  const root = join(homedir(), 'Library/Application Support/AddressBook');
  const files = [join(root, 'AddressBook-v22.abcddb')];
  const sources = join(root, 'Sources');
  if (existsSync(sources)) {
    for (const dir of readdirSync(sources)) files.push(join(sources, dir, 'AddressBook-v22.abcddb'));
  }
  return files.filter(f => existsSync(f));
}

export function readContacts(): Contact[] {
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


/**
 * Phone numbers (E.164) of people Maddie texts with one-on-one: at least
 * `minMessages` messages in the last `days` days, at least one sent by her.
 * Reads only who and how often, never message text.
 */
export function recentTextingPartners(days = 180, minMessages = 5): Map<string, number> {
  const db = new DatabaseSync(join(homedir(), 'Library/Messages/chat.db'), { readOnly: true });
  // message.date is nanoseconds since 2001-01-01 UTC.
  const since = (Date.now() - days * 86_400_000 - Date.UTC(2001, 0, 1)) * 1_000_000;
  const rows = db.prepare(
    `SELECT h.id AS handle, COUNT(*) AS total, SUM(m.is_from_me) AS mine
     FROM message m
     JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
     JOIN chat_handle_join chj ON chj.chat_id = cmj.chat_id
     JOIN handle h ON h.ROWID = chj.handle_id
     WHERE m.date > ?
       AND (SELECT COUNT(*) FROM chat_handle_join x WHERE x.chat_id = cmj.chat_id) = 1
     GROUP BY h.id`
  ).all(since) as Array<{ handle: string; total: number; mine: number }>;
  db.close();
  const partners = new Map<string, number>();
  for (const r of rows) {
    const phone = toE164(r.handle);
    if (phone && r.total >= minMessages && r.mine >= 1) partners.set(phone, (partners.get(phone) || 0) + r.total);
  }
  return partners;
}
