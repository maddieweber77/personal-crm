import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runMigrations() {
  // Create a connection to the database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Starting database migrations...');

    // Read the migration file
    const migrationPath = join(process.cwd(), 'migrations', '001_create_tables.sql');
    const migrationSql = readFileSync(migrationPath, 'utf-8');

    // Run the migration
    await pool.query(migrationSql);

    console.log('✓ Migration 001_create_tables.sql completed successfully');
    console.log('\nDatabase is ready!');
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
