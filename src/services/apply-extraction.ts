import {
  getRoster,
  createPerson,
  addAliases,
  createPersonUpdate,
  updateLastContactDate,
  updateLastSeenDate,
  createFriendEvent,
  createFriendSituation,
  createPendingMention,
  type UpdateSource,
} from '../database/client';
import {
  extractMentions,
  resolveMention,
  newAliases,
  normalizeName,
  parseIsoDate,
  type ExtractedMention,
  type RosterPerson,
} from './person-resolver';

/**
 * Shared by phone calls and texted notes: find who was mentioned, then save
 * what's new about each person. Mentions we can't pin to one person are
 * parked in pending_mentions (nothing is written to anyone) until Maddie
 * says who it was.
 */

export interface EntrySource {
  kind: 'voice' | 'manual';
  entryId: string;
  /** For 'manual' entries that are synced text conversations (default: a texted note). */
  isConversation?: boolean;
  /** Names of the people in that conversation (besides Maddie). */
  participants?: string[];
}

export interface ProcessResult {
  matched: string[]; // names of existing people updated
  created: string[]; // names of new people added
  pending: string[]; // mentions waiting for Maddie ("Sarah")
}

/** Everything this needs from the database, so tests can pass a fake. */
export interface PeopleStore {
  getRoster(): Promise<RosterPerson[]>;
  createPerson(name: string, aliases: string[], relationship: ExtractedMention['relationship']): Promise<{ id: string; name: string }>;
  addAliases(personId: string, aliases: string[]): Promise<void>;
  createPersonUpdate(personId: string, source: UpdateSource, text: string, context: string | null): Promise<unknown>;
  updateLastContactDate(personId: string, date: Date): Promise<void>;
  updateLastSeenDate(personId: string, day: string): Promise<void>;
  createFriendEvent(
    personId: string, type: ExtractedMention['events'][number]['event_type'], description: string,
    date: Date | null, approximate: string | null, isRecurring: boolean, sourceEntryId: string
  ): Promise<unknown>;
  createFriendSituation(
    personId: string, type: ExtractedMention['situations'][number]['situation_type'], description: string,
    severity: 'high' | 'medium' | 'low', startedAt: Date, sourceEntryId: string
  ): Promise<unknown>;
  createPendingMention(
    mention: string, candidateIds: string[], extracted: ExtractedMention,
    source: EntrySource, occurredAt: Date
  ): Promise<unknown>;
}

const dbStore: PeopleStore = {
  getRoster, createPerson, addAliases, createPersonUpdate, updateLastContactDate, updateLastSeenDate,
  createFriendEvent, createFriendSituation, createPendingMention,
};

/** YYYY-MM-DD for a moment, in Maddie's timezone. */
export function dateInNewYork(moment: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(moment);
}

/**
 * Extract + resolve + save. Throws only if Claude itself fails (callers
 * already log and continue); a bad single mention never blocks the others.
 */
export async function processEntry(
  sourceText: string,
  source: EntrySource,
  occurredAt: Date,
  store: PeopleStore = dbStore,
  extract: typeof extractMentions = extractMentions
): Promise<ProcessResult> {
  const result: ProcessResult = { matched: [], created: [], pending: [] };
  const roster = await store.getRoster();
  const extraction = await extract(
    sourceText,
    source.kind === 'voice' ? 'voice call transcript' : source.isConversation ? 'text conversation' : 'text message or screenshot',
    roster,
    dateInNewYork(occurredAt)
  );
  const byId = new Map(roster.map(p => [p.id, p]));

  for (const mention of extraction.people) {
    const resolution = resolveMention(mention, roster);

    // Text conversations mention lots of people in passing. Only keep a new
    // person there if we know their full name or they're in the conversation;
    // and don't ask Maddie about nameless mentions ("ur dad", "the Darden girl").
    if (source.isConversation) {
      const inConversation = (source.participants ?? []).some(p => normalizeName(p) === normalizeName(mention.full_name || mention.mention));
      const hasFullName = (mention.full_name || '').trim().includes(' ');
      if (resolution.kind === 'new' && !inConversation && !hasFullName) continue;
      if (resolution.kind === 'unsure' && resolution.candidateIds.length === 0) continue;
    }

    if (resolution.kind === 'unsure') {
      await store.createPendingMention(mention.mention, resolution.candidateIds, mention, source, occurredAt);
      result.pending.push(mention.mention);
      continue;
    }

    let personId: string;
    if (resolution.kind === 'existing') {
      const person = byId.get(resolution.personId)!;
      personId = person.id;
      const aliases = newAliases(mention, person);
      if (aliases.length) await store.addAliases(personId, aliases);
      result.matched.push(person.name);
    } else {
      const created = await store.createPerson(resolution.name, mention.aliases, mention.relationship);
      personId = created.id;
      // Later mentions in this same entry can match the new person.
      const fresh = { id: created.id, name: created.name, aliases: mention.aliases, relationship: mention.relationship, recent: [] };
      roster.push(fresh);
      byId.set(fresh.id, fresh);
      result.created.push(created.name);
    }

    await saveDetails(store, personId, mention, source, occurredAt);
  }

  return result;
}

/** Write one person's updates, events, situations and last-contact date. */
export async function saveDetails(
  store: PeopleStore,
  personId: string,
  mention: ExtractedMention,
  source: EntrySource,
  occurredAt: Date
): Promise<void> {
  const updateSource = source.kind === 'voice'
    ? { voiceEntryId: source.entryId, manualEntryId: null }
    : { voiceEntryId: null, manualEntryId: source.entryId };

  // Per person: only the people Maddie actually talked to or saw.
  if (mention.interacted) {
    await store.updateLastContactDate(personId, occurredAt);
  }

  // In-person time is tracked separately: texting isn't seeing someone.
  const seen = parseIsoDate(mention.saw_in_person);
  if (seen && seen.getTime() <= occurredAt.getTime() + 86_400_000) {
    await store.updateLastSeenDate(personId, mention.saw_in_person!);
  }

  for (const update of mention.updates) {
    await store.createPersonUpdate(personId, updateSource, update.update_text, update.context);
  }

  for (const event of mention.events) {
    const eventDate = parseIsoDate(event.event_date);
    // An unparseable "date" isn't thrown away: it becomes the approximate timing.
    const approximate = event.event_date_approximate ?? (eventDate ? null : event.event_date);
    await store.createFriendEvent(
      personId, event.event_type, event.event_description, eventDate, approximate,
      event.event_type === 'birthday', source.entryId
    );
  }

  for (const situation of mention.situations) {
    const startedAt = parseIsoDate(situation.started_at) ?? occurredAt;
    await store.createFriendSituation(
      personId, situation.situation_type, situation.situation_description,
      situation.severity, startedAt, source.entryId
    );
  }
}
