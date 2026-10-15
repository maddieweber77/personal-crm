/**
 * What a person looks like after merging a duplicate into them.
 * Pure (no database) so the rules are easy to test and read.
 */

export interface MergeablePerson {
  id: string;
  name: string;
  aliases: string[];
  relationship: string | null;
  priority_level: string | null;
  last_contact_date: Date | null;
  phone_numbers: string[];
  birthday: Date | null;
}

export interface MergedFields {
  aliases: string[];
  relationship: string | null;
  priority_level: string;
  last_contact_date: Date | null;
  phone_numbers: string[];
  birthday: Date | null;
}

function uniqueCaseInsensitive(values: string[], exclude: string): string[] {
  const seen = new Set([exclude.trim().toLowerCase()]);
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

export function planMerge(survivor: MergeablePerson, duplicate: MergeablePerson): MergedFields {
  const latest = [survivor.last_contact_date, duplicate.last_contact_date]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return {
    // The duplicate's name becomes a nickname, so "Sarah" still finds "Sarah Kim".
    aliases: uniqueCaseInsensitive([...survivor.aliases, duplicate.name, ...duplicate.aliases], survivor.name),
    relationship:
      survivor.relationship && survivor.relationship !== 'unknown' ? survivor.relationship : duplicate.relationship,
    priority_level: survivor.priority_level === 'high' || duplicate.priority_level === 'high' ? 'high' : 'normal',
    last_contact_date: latest,
    phone_numbers: [...new Set([...survivor.phone_numbers, ...duplicate.phone_numbers])],
    birthday: survivor.birthday ?? duplicate.birthday,
  };
}
