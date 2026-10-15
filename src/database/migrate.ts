import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Files that ran (every time) before this runner tracked what it applied.
// 004 re-seeds the priority-friends list, so running it again would undo
// merges and overwrite learned aliases. On a database that already has the
// tables, these are recorded as applied instead of being run again.
export const BASELINE_MIGRATIONS = [
  '001_create_tables.sql',
  '002_add_manual_entries.sql',
  '003_add_friend_tracking.sql',
  '004_seed_priority_friends.sql',
];

/**
 * Which files still need to run: everything not yet recorded, in name order.
 * Pure so it can be tested without a database.
 */
export function pendingMigrations(allFiles: string[], applied: Set<string>): string[] {
  return allFiles
    .filter(file => file.endsWith('.sql'))
    .sort() // Sorts alphabetically (001, 002, etc.)
    .filter(file => !applied.has(file));
}

async function runMigrations() {
  // Create a connection to the database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Starting database migrations...');

    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    let applied = new Set(
      (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(r => r.filename)
    );

    // First run of the tracking runner on an existing database: baseline it.
    const hasPeopleTable = (await pool.query(`SELECT to_regclass('public.people') AS t`)).rows[0].t !== null;
    if (applied.size === 0 && hasPeopleTable) {
      console.log('Existing database found: recording 001-004 as already applied (not re-running them)');
      for (const file of BASELINE_MIGRATIONS) {
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
      }
      applied = new Set(BASELINE_MIGRATIONS);
    }

    const migrationsDir = join(process.cwd(), 'migrations');
    const toRun = pendingMigrations(readdirSync(migrationsDir), applied);
    if (toRun.length === 0) {
      console.log('Nothing to run: database is up to date.');
    }

    // Run each new migration in its own transaction, and record it
    for (const file of toRun) {
      console.log(`Running migration: ${file}`);
      const migrationSql = readFileSync(join(migrationsDir, file), 'utf-8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migrationSql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      console.log(`✓ Migration ${file} completed successfully`);
    }

    console.log('\nAll migrations completed! Database is ready!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runMigrations };
