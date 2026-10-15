import { normalizeName } from './person-resolver';

/**
 * Matching people in the CRM to the Mac Contacts app, so each person gets
 * their phone number(s): the one identifier texts and calls can't get wrong.
 * Pure functions only; scripts/contacts-match.ts does the reading/writing.
 */

export interface Contact {
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  phones: string[]; // E.164
  birthday: string | null; // YYYY-MM-DD (year 1604 = Apple's "no year")
}

export interface CrmPerson {
  id: string;
  name: string;
  aliases: string[];
}

export type ContactMatch =
  | { kind: 'exact'; person: CrmPerson; contact: Contact } // full name or nickname matches exactly one contact
  | { kind: 'likely'; person: CrmPerson; contact: Contact } // first name only, and exactly one contact has it
  | { kind: 'ambiguous'; person: CrmPerson; contacts: Contact[] }
  | { kind: 'none'; person: CrmPerson };

/** "(704) 555-1234" -> "+17045551234". Returns null for short codes / junk. */
export function toE164(raw: string, defaultCountry = '1'): string | null {
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (plus) return digits.length >= 8 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Apple stores dates as seconds since 2001-01-01 UTC. */
export function appleDateToIso(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  return new Date(Date.UTC(2001, 0, 1) + seconds * 1000).toISOString().slice(0, 10);
}

export function contactFullName(c: Contact): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
}

export function matchPerson(person: CrmPerson, contacts: Contact[]): ContactMatch {
  const wanted = new Set([person.name, ...person.aliases].map(normalizeName).filter(Boolean));
  const exact = contacts.filter(c =>
    wanted.has(normalizeName(contactFullName(c))) || (c.nickname && wanted.has(normalizeName(c.nickname)))
  );
  // Full names only count as exact when they have a last name ("Sarah" isn't specific).
  const specific = exact.filter(c => normalizeName(contactFullName(c)).includes(' ') || c.nickname);
  if (specific.length === 1) return { kind: 'exact', person, contact: specific[0] };
  if (specific.length > 1) return { kind: 'ambiguous', person, contacts: specific };

  const parts = normalizeName(person.name).split(' ');
  if (parts.length === 1 && parts[0]) {
    const sameFirst = contacts.filter(c => normalizeName(c.firstName || '') === parts[0]);
    if (sameFirst.length === 1) return { kind: 'likely', person, contact: sameFirst[0] };
    if (sameFirst.length > 1) return { kind: 'ambiguous', person, contacts: sameFirst };
  }
  if (exact.length === 1) return { kind: 'likely', person, contact: exact[0] };
  return { kind: 'none', person };
}

/**
 * Likely duplicates among CRM people: same first name where one has no last
 * name or both have the same one ("Sarah" + "Sarah Kim"), or a shared alias.
 */
export function findDuplicatePairs(people: CrmPerson[]): Array<[CrmPerson, CrmPerson]> {
  const pairs: Array<[CrmPerson, CrmPerson]> = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = normalizeName(people[i].name).split(' ');
      const b = normalizeName(people[j].name).split(' ');
      const sameFirst = a[0] && a[0] === b[0];
      const lastCompatible = a.length === 1 || b.length === 1 || a[a.length - 1] === b[b.length - 1];
      const aNames = new Set([people[i].name, ...people[i].aliases].map(normalizeName));
      const sharedAlias = [people[j].name, ...people[j].aliases].map(normalizeName).some(n => n && aNames.has(n));
      if ((sameFirst && lastCompatible) || sharedAlias) pairs.push([people[i], people[j]]);
    }
  }
  return pairs;
}
