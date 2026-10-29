import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getEnvConfig } from '../src/config/env.js';

export function runMigrations(dbInstance?: DatabaseSync): void {
  const env = getEnvConfig();
  const dbPath = env.DATABASE_PATH;

  let db: DatabaseSync;
  let shouldClose = false;

  if (dbInstance) {
    db = dbInstance;
  } else {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new DatabaseSync(dbPath);
    shouldClose = true;
  }

  // Enable WAL mode and foreign key constraints
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);

    if (!existing) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      db.exec('BEGIN IMMEDIATE;');
      try {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(version, file, new Date().toISOString());
        db.exec('COMMIT;');
        console.log(`[Migrations] Applied migration: ${file}`);
      } catch (err) {
        db.exec('ROLLBACK;');
        console.error(`[Migrations] Failed applying migration ${file}:`, err);
        throw err;
      }
    }
  }

  if (shouldClose) {
    db.close();
  }
}

if (process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))) {
  try {
    console.log('[Migrations] Running migrations...');
    runMigrations();
    console.log('[Migrations] All migrations completed successfully.');
  } catch (error) {
    console.error('[Migrations] Migration failed:', error);
    process.exit(1);
  }
}
