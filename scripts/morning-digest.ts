/**
 * Run the morning digest by hand.
 *
 *   npm run digest:preview                        print today's digest; sends nothing, no database
 *   npm run digest:preview -- --file my.ics       read a local .ics file instead of the calendar URL
 *   npm run digest:preview -- --date 2026-11-01   preview a different day
 *   npm run digest:send                           REALLY send today's digest (SMS + email, writes digest_log)
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { runMorningDigest } from '../src/services/morning-digest-job';
import { closePool } from '../src/database/client';

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const preview = args.includes('--preview');
  const send = args.includes('--send');
  const icsFile = readFlag(args, '--file');
  const date = readFlag(args, '--date');

  if (preview === send) {
    throw new Error('Use exactly one of --preview or --send (try: npm run digest:preview)');
  }
  if (send && (icsFile || date)) {
    throw new Error('--file and --date only work with --preview');
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('--date must look like 2026-10-14');
  }

  const result = await runMorningDigest({ dryRun: preview, icsFile, date });

  if (result.outcome === 'already_sent') {
    console.log(`Already sent for ${result.date}; nothing to do.`);
    return;
  }

  const { digest } = result;
  console.log(`\n===== SMS (${digest.sms.length} chars) =====\n${digest.sms}`);
  console.log(`\n===== EMAIL =====\nSubject: ${digest.emailSubject}\n\n${digest.emailText}`);

  if (result.outcome === 'preview') {
    console.log('(Preview only: nothing was sent.)');
  } else if (result.outcome === 'sent') {
    console.log(`SMS: ${result.smsOk ? 'sent' : 'FAILED'}, email: ${result.emailOk ? 'sent' : 'FAILED'}`);
  } else {
    console.log('SMS and email both FAILED (the day was un-claimed, so you can retry).');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closePool());
