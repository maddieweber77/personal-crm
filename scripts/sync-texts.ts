/**
 * Read text conversations from Messages and save what's new about people
 * (run on the laptop; needs Full Disk Access for the terminal).
 *
 *   npx tsx scripts/sync-texts.ts --only "Claire Starcher;Bella;Heidi" --plan   # who'd be read, sizes, cost: no API, no writes
 *   npx tsx scripts/sync-texts.ts --only "..." --days 180 --apply --limit 5      # first 5 conversations
 *   npx tsx scripts/sync-texts.ts --only "..." --days 180 --apply                # the rest (resumes)
 *
 * Message text never leaves the laptop except to Claude for extraction; the
 * database only gets the facts (plus a one-line "Texts with X" source row).
 * Progress is saved per chat in ~/.personal-crm-text-sync.json, so re-runs
 * only read newer messages.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConversations, type Conversation } from './lib/mac-data';
import { normalizeName } from '../src/services/person-resolver';
import { processEntry } from '../src/services/apply-extraction';
import { createManualEntry, closePool } from '../src/database/client';

const STATE_FILE = join(homedir(), '.personal-crm-text-sync.json');
const CHUNK_CHARS = 60_000; // ~15k tokens per Claude call
const USD_PER_M_INPUT = 4, USD_PER_M_OUTPUT = 20; // claude-opus-5-5

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadState(): Record<string, number> {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
}

/** "Bella" matches "Bella Smith"; a group matches when every listed name is in it ("Bella + Heidi"). */
function pickConversations(all: Conversation[], wanted: string[]): Array<{ wanted: string; convo: Conversation | null }> {
  return wanted.map(w => {
    const parts = w.split('+').map(x => normalizeName(x)).filter(Boolean);
    const isGroupWish = parts.length > 1;
    const fits = (name: string, part: string) => {
      const n = normalizeName(name);
      return n === part || n.startsWith(part + ' ') || n.split(' ').includes(part);
    };
    const matches = all.filter(c =>
      c.isGroup === isGroupWish &&
      parts.every(part => c.participants.some(p => fits(p, part))) &&
      (!isGroupWish || c.participants.length <= parts.length + 1)
    );
    // Most-texted match wins ("Katie" -> the Katie she texts most).
    matches.sort((a, b) => b.messages.length - a.messages.length);
    return { wanted: w, convo: matches[0] ?? null };
  });
}

function toChunks(c: Conversation): Array<{ text: string; from: Date; to: Date; lastRowId: number }> {
  const chunks: Array<{ text: string; from: Date; to: Date; lastRowId: number }> = [];
  let lines: string[] = [], size = 0, first = c.messages[0];
  c.messages.forEach((m, i) => {
    const line = `${m.at.toISOString().slice(0, 10)} ${m.from}: ${m.text}`;
    lines.push(line); size += line.length + 1;
    const last = i === c.messages.length - 1;
    if (size >= CHUNK_CHARS || last) {
      chunks.push({ text: `Text conversation: ${c.title}\n\n${lines.join('\n')}`, from: first.at, to: m.at, lastRowId: m.rowId });
      lines = []; size = 0; first = c.messages[i + 1];
    }
  });
  return chunks;
}

async function main() {
  const only = arg('--only');
  if (!only) throw new Error('Pass --only "Name;Name;Bella + Heidi" (the people whose texts to read)');
  const days = Number(arg('--days') ?? 180);
  const limit = Number(arg('--limit') ?? Infinity);
  const apply = process.argv.includes('--apply');
  const state = loadState();

  const all = readConversations({ days, afterRowId: state, minMessages: 1 });
  const picked = pickConversations(all, only.split(';').map(s => s.trim()).filter(Boolean));

  let totalChars = 0;
  for (const { wanted, convo } of picked) {
    if (!convo) { console.log(`  ${wanted}: no conversation found`); continue; }
    const chars = convo.messages.reduce((n, m) => n + m.text.length + 20, 0);
    totalChars += chars;
    console.log(`  ${wanted} -> ${convo.title}: ${convo.messages.length} new messages`);
  }
  const inTokens = totalChars / 4 + picked.length * 3000; // + instructions/roster per call
  const estimate = (inTokens * USD_PER_M_INPUT + inTokens * 0.15 * USD_PER_M_OUTPUT) / 1e6;
  console.log(`About ${Math.round(totalChars / 4 / 1000)}k tokens of text; estimated cost ~$${estimate.toFixed(2)}.`);
  if (!apply) { console.log('Plan only: nothing sent to Claude, nothing saved.'); return; }

  let done = 0;
  for (const { convo } of picked) {
    if (!convo || done >= limit) continue;
    for (const chunk of toChunks(convo)) {
      const range = `${chunk.from.toISOString().slice(0, 10)} to ${chunk.to.toISOString().slice(0, 10)}`;
      const entry = await createManualEntry('text', null, null, null, `Texts with ${convo.title}, ${range} (synced from Messages)`);
      const result = await processEntry(chunk.text, { kind: 'manual', entryId: entry.id, isConversation: true, participants: convo.participants }, chunk.to);
      console.log(`  ${convo.title} (${range}): ${result.matched.length} matched, ${result.created.length} new, ${result.pending.length} to confirm`);
      state[String(convo.chatId)] = chunk.lastRowId; // only after the chunk is saved
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
    }
    done++;
  }
}

main()
  .catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => closePool());
