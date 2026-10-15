import { z } from 'zod';
import { askClaudeForJson } from './claude';

/**
 * Turns a call transcript or a text into "who was mentioned + what's new",
 * matched against the people already in the database.
 *
 * Claude proposes a match for each mention; resolveMention() then checks
 * that proposal in plain code. The rule throughout: when unsure, ask Maddie
 * instead of guessing. A wrong match files private details under the wrong
 * friend; a question costs her one tap.
 */

/** One person as Claude sees them when matching names. */
export interface RosterPerson {
  id: string;
  name: string;
  aliases: string[];
  relationship: string | null;
  recent: string[]; // latest few update texts, for context ("Sarah, the one who just moved to Denver")
}

const RELATIONSHIP = z.enum(['friend', 'family', 'coworker', 'unknown']);

const MentionSchema = z.object({
  mention: z.string().describe('The name or phrase used in the source, e.g. "Gracie" or "my sister"'),
  match: z.enum(['existing', 'new', 'unsure']),
  person_id: z.string().nullable().describe('Roster id when match is "existing", otherwise null'),
  candidate_ids: z.array(z.string()).describe('Roster ids this could be, when match is "unsure"'),
  full_name: z.string().nullable().describe('Full name if the source says it, otherwise null'),
  aliases: z.array(z.string()).describe('Nicknames used for them in the source'),
  relationship: RELATIONSHIP,
  interacted: z.boolean().describe('True only if Maddie talked to, texted, called or saw THIS person'),
  updates: z.array(z.object({
    update_text: z.string(),
    context: z.string().nullable(),
  })),
  events: z.array(z.object({
    event_type: z.enum(['birthday', 'wedding', 'trip', 'interview', 'surgery', 'other']),
    event_description: z.string(),
    event_date: z.string().nullable().describe('YYYY-MM-DD, or null if no exact date'),
    event_date_approximate: z.string().nullable().describe('e.g. "next month" when there is no exact date'),
  })),
  situations: z.array(z.object({
    situation_type: z.enum(['breakup', 'sick_family', 'wedding_planning', 'new_job', 'tough_time', 'other']),
    situation_description: z.string(),
    severity: z.enum(['high', 'medium', 'low']),
    started_at: z.string().describe('YYYY-MM-DD'),
  })),
});

export const ExtractionSchema = z.object({ people: z.array(MentionSchema) });
export type ExtractedMention = z.infer<typeof MentionSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

// Kept identical on every call so it can be cached.
const SYSTEM_PROMPT = `You read Maddie's voice journal entries and the notes she texts in, and record what's going on with the people in her life.

For every person mentioned (not Maddie herself, not public figures or businesses), return one entry.

Matching to the ROSTER (people already in her database):
- "existing" + person_id: the mention clearly refers to exactly one roster person, by name, nickname, or unmistakable context (their recent updates help: "Sarah, who just moved to Denver").
- "new": clearly someone not on the roster.
- "unsure" + candidate_ids: it could be more than one roster person, or it could be a roster person or someone new, and the source doesn't settle it. Also use "unsure" (with no candidates) when the source never says the person's name ("my sister's boyfriend") and nobody on the roster clearly fits.
- Never guess. A wrong match files private details under the wrong friend; "unsure" just means Maddie gets asked. Only use ids that appear in the roster.

For each person:
- interacted: true only if Maddie herself talked to, texted, called or saw THIS person (judge each person separately; someone only talked about is false).
- updates: short, specific facts about their life, written in third person ("Started a new job at Google"). No filler.
- events: upcoming things worth remembering (birthdays, weddings, trips, interviews, surgeries, other). Resolve relative dates against today's date; if there's no exact date, set event_date to null and put the timing in event_date_approximate.
- situations: ongoing things where she may want to check in. Severity: high = major life events (death, serious illness, breakup, job loss); medium = challenging but manageable (wedding planning, new job, family stress); low = minor (busy season, small health issue). started_at defaults to today.
- If nothing new is said about someone, return empty lists for them rather than inventing details.`;

/** Roster as compact lines: id | name | aka | relationship | recent updates. */
export function formatRoster(roster: RosterPerson[]): string {
  if (roster.length === 0) return '(empty: nobody saved yet)';
  return roster
    .map(p => {
      const aka = p.aliases.length ? ` | aka ${p.aliases.join(', ')}` : '';
      const recent = p.recent.length
        ? ` | recent: ${p.recent.map(r => `"${r.length > 120 ? r.slice(0, 117) + '...' : r}"`).join('; ')}`
        : '';
      return `${p.id} | ${p.name}${aka} | ${p.relationship || 'unknown'}${recent}`;
    })
    .join('\n');
}

/** Ask Claude who was mentioned and what's new. Throws if Claude fails. */
export async function extractMentions(
  sourceText: string,
  sourceKind: 'voice call transcript' | 'text message or screenshot',
  roster: RosterPerson[],
  today: string // YYYY-MM-DD in Maddie's timezone
): Promise<Extraction> {
  const user = `Today is ${today} (America/New_York).

ROSTER:
${formatRoster(roster)}

SOURCE (${sourceKind}):
${sourceText}`;
  return askClaudeForJson({ schema: ExtractionSchema, system: SYSTEM_PROMPT, user });
}

// ---------- Plain-code checks on Claude's proposal ----------

export type Resolution =
  | { kind: 'existing'; personId: string }
  | { kind: 'new'; name: string }
  | { kind: 'unsure'; candidateIds: string[] };

/** "Gracie-Mae O'Neil " -> "graciemae oneil" (lowercase, letters/spaces only, accents removed). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstName(name: string): string {
  return normalizeName(name).split(' ')[0] || '';
}

function lastName(name: string): string | null {
  const parts = normalizeName(name).split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

const NOT_A_NAME_START = new Set(['my', 'our', 'her', 'his', 'their', 'the', 'a', 'an', 'this', 'that', 'some']);

/** "Grace", "Mom", "Dr. Patel" look like names; "my sister's boyfriend" doesn't. */
export function looksLikeName(text: string): boolean {
  const trimmed = text.trim();
  const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  return trimmed.length > 0 && !NOT_A_NAME_START.has(first) && /[A-Z]/.test(trimmed);
}

/** Roster people this name could plausibly be: same first name, or a matching alias. */
export function nameCandidates(mention: ExtractedMention, roster: RosterPerson[]): RosterPerson[] {
  const said = [mention.mention, mention.full_name, ...mention.aliases].filter((s): s is string => !!s);
  const saidFull = new Set(said.map(normalizeName));
  const saidFirst = new Set(said.map(firstName).filter(Boolean));
  return roster.filter(p =>
    saidFirst.has(firstName(p.name)) ||
    saidFull.has(normalizeName(p.name)) ||
    p.aliases.some(a => saidFull.has(normalizeName(a)))
  );
}

/**
 * Decide what to do with one mention. Claude's answer is a proposal; this
 * makes sure ids are real and that "new" never silently duplicates someone.
 */
export function resolveMention(mention: ExtractedMention, roster: RosterPerson[]): Resolution {
  const rosterIds = new Set(roster.map(p => p.id));
  const displayName = (mention.full_name || mention.mention).trim();

  if (mention.match === 'existing' && mention.person_id && rosterIds.has(mention.person_id)) {
    return { kind: 'existing', personId: mention.person_id };
  }

  if (mention.match === 'unsure') {
    const claimed = mention.candidate_ids.filter(id => rosterIds.has(id));
    const candidates = claimed.length ? claimed : nameCandidates(mention, roster).map(p => p.id);
    if (candidates.length > 0 || !looksLikeName(displayName)) {
      return { kind: 'unsure', candidateIds: candidates };
    }
    return { kind: 'new', name: displayName };
  }

  // "new", or "existing" with an id that isn't on the roster.
  const lookalikes = nameCandidates(mention, roster);
  if (lookalikes.length > 0) {
    // "Sarah Lee" is safely new when every roster Sarah has a different last name.
    const saidLast = mention.full_name ? lastName(mention.full_name) : null;
    const allDifferent = saidLast !== null &&
      lookalikes.every(p => {
        const theirLast = lastName(p.name);
        return theirLast !== null && theirLast !== saidLast;
      });
    if (mention.match === 'new' && allDifferent) return { kind: 'new', name: displayName };
    return { kind: 'unsure', candidateIds: lookalikes.map(p => p.id) };
  }
  if (!looksLikeName(displayName)) return { kind: 'unsure', candidateIds: [] };
  return { kind: 'new', name: displayName };
}

/**
 * Nicknames worth remembering for a matched person: "Gracie" for Grace Smith,
 * but not plain "Grace" (a bare first name could be someone else later).
 */
export function newAliases(mention: ExtractedMention, person: { name: string; aliases: string[] }): string[] {
  const known = new Set([normalizeName(person.name), firstName(person.name), ...person.aliases.map(normalizeName)]);
  const result: string[] = [];
  for (const raw of [mention.mention, ...mention.aliases]) {
    const alias = raw.trim();
    const key = normalizeName(alias);
    if (!key || known.has(key) || !looksLikeName(alias)) continue;
    known.add(key);
    result.push(alias);
  }
  return result;
}

/** "2026-03-15" -> Date; anything else -> null. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`); // noon UTC: same calendar day in US timezones
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}
