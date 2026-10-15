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

/** Message text: newer macOS keeps it in `attributedBody` (a serialized NSAttributedString), not `text`. */
export function decodeAttributedBody(blob: Uint8Array | null): string | null {
  if (!blob) return null;
  const b = Buffer.from(blob);
  const i = b.indexOf('NSString');
  if (i < 0) return null;
  let p = i + 'NSString'.length + 5; // class-info bytes, then a length prefix
  let len = b[p++];
  if (len === 0x81) { len = b.readUInt16LE(p); p += 2; }
  else if (len === 0x82) { len = b.readUInt32LE(p); p += 4; }
  return b.subarray(p, p + len).toString('utf8');
}

/** Contacts as handle (E.164 phone or lowercase email) -> display name. */
export function handleNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const c of readContacts()) {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
    for (const phone of c.phones) names.set(phone, name);
  }
  for (const file of addressBookFiles()) {
    const db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare(
      `SELECT r.ZFIRSTNAME AS first, r.ZLASTNAME AS last, e.ZADDRESS AS email
       FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER WHERE e.ZADDRESS IS NOT NULL`
    ).all() as Array<{ first: string | null; last: string | null; email: string }>;
    for (const r of rows) {
      const name = [r.first, r.last].filter(Boolean).join(' ');
      if (name) names.set(r.email.toLowerCase(), name);
    }
    db.close();
  }
  return names;
}

export function normalizeHandle(handle: string): string {
  return handle.includes('@') ? handle.toLowerCase() : (toE164(handle) ?? handle);
}

export interface Conversation {
  chatId: number;
  title: string; // "Sarah Kim" or "Group: Sarah Kim, Grace Pickett"
  participants: string[]; // display names, not including Maddie
  isGroup: boolean;
  messages: Array<{ rowId: number; at: Date; from: string; text: string }>;
}

/**
 * 1:1 and small-group (2-6 people) conversations with messages newer than
 * `afterRowId` (per chat) and within the last `days`. Only chats where every
 * other person is in Contacts, Maddie sent at least one message, and there
 * are at least `minMessages` new messages.
 */
export function readConversations(opts: { days: number; afterRowId: Record<string, number>; minMessages: number }): Conversation[] {
  const names = handleNames();
  const db = new DatabaseSync(join(homedir(), 'Library/Messages/chat.db'), { readOnly: true });
  // message.date is nanoseconds since 2001-01-01; compare in milliseconds (fits in a JS number).
  const sinceMs = Date.now() - opts.days * 86_400_000 - Date.UTC(2001, 0, 1);
  const chats = db.prepare(
    `SELECT c.ROWID AS id, c.display_name AS displayName, GROUP_CONCAT(h.id, '|') AS handles, COUNT(*) AS people
     FROM chat c JOIN chat_handle_join chj ON chj.chat_id = c.ROWID JOIN handle h ON h.ROWID = chj.handle_id
     GROUP BY c.ROWID HAVING people BETWEEN 1 AND 6`
  ).all() as Array<{ id: number; displayName: string | null; handles: string; people: number }>;
  const messageQuery = db.prepare(
    `SELECT m.ROWID AS rowId, CAST(m.date / 1000000 AS INTEGER) AS dateMs, m.is_from_me AS fromMe, h.id AS handle, m.text AS text, m.attributedBody AS body
     FROM message m JOIN chat_message_join cmj ON cmj.message_id = m.ROWID LEFT JOIN handle h ON h.ROWID = m.handle_id
     WHERE cmj.chat_id = ? AND m.date / 1000000 > ? AND m.ROWID > ? AND m.associated_message_type = 0
     ORDER BY m.date`
  );

  // The same person can have several chats (phone + email); merge by participants.
  const byPeople = new Map<string, Conversation>();
  for (const chat of chats) {
    const handles = [...new Set(chat.handles.split('|').map(normalizeHandle))];
    const participants = handles.map(h => names.get(h));
    if (participants.some(n => !n)) continue; // someone not in Contacts: likely business or spam
    const rows = messageQuery.all(chat.id, sinceMs, opts.afterRowId[String(chat.id)] ?? 0) as Array<{
      rowId: number; dateMs: number; fromMe: number; handle: string | null; text: string | null; body: Uint8Array | null;
    }>;
    const messages = rows
      .map(r => ({
        rowId: r.rowId,
        at: new Date(Date.UTC(2001, 0, 1) + r.dateMs),
        from: r.fromMe ? 'Maddie' : names.get(normalizeHandle(r.handle ?? '')) ?? 'Them',
        text: (r.text ?? decodeAttributedBody(r.body) ?? '').replace(/￼/g, '[attachment]').trim(),
      }))
      .filter(m => m.text);
    const key = (participants as string[]).slice().sort().join(' + ');
    const existing = byPeople.get(key);
    const convo: Conversation = existing ?? {
      chatId: chat.id,
      title: handles.length > 1 ? `Group${chat.displayName ? ` "${chat.displayName}"` : ''}: ${participants.join(', ')}` : participants[0]!,
      participants: participants as string[],
      isGroup: handles.length > 1,
      messages: [],
    };
    convo.messages.push(...messages);
    byPeople.set(key, convo);
  }
  db.close();

  return [...byPeople.values()]
    .map(c => ({ ...c, messages: c.messages.sort((a, b) => a.at.getTime() - b.at.getTime()) }))
    .filter(c => c.messages.length >= opts.minMessages && c.messages.some(m => m.from === 'Maddie'));
}
