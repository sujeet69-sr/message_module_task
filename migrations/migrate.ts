import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { getDatabasePool, withTransaction } from '../src/db/database.js';
import { logger } from '../src/utils/logger.js';

export async function runMigrations(customPool?: pg.Pool): Promise<void> {
  const pool = customPool || getDatabasePool();

  // 1. Ensure migration tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
    );
  `);

  const migrationsDir = path.resolve(__dirname);
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const versionMatch = file.match(/^(\d+)_/);
    if (!versionMatch) continue;

    const version = parseInt(versionMatch[1], 10);
    const existing = await pool.query('SELECT version FROM schema_migrations WHERE version = $1', [version]);

    if (existing.rows.length === 0) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)',
          [version, file, new Date().toISOString()]
        );
      });

      logger.info(`[PostgreSQL Migrations] Applied migration: ${file}`);
      console.log(`[PostgreSQL Migrations] Applied migration: ${file}`);
    }
  }
}

export async function runAllMigrations(customPool?: pg.Pool): Promise<void> {
  await runMigrations(customPool);
}

if (process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))) {
  runMigrations()
    .then(() => {
      console.log('[PostgreSQL Migrations] All migrations completed successfully.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[PostgreSQL Migrations] Migration failed:', error);
      process.exit(1);
    });
}
