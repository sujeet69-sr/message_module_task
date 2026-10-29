import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../migrations/migrate.js';
import { resetDatabaseAdapter } from '../../src/db/adapter.js';
import { closeDatabase, getDatabase } from '../../src/db/database.js';

export interface TestDbContext {
  dbPath: string;
  db: DatabaseSync;
  cleanup: () => void;
}

export function createTestDatabase(): TestDbContext {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-api-test-'));
  const dbPath = path.join(tempDir, 'test.db');

  process.env.DATABASE_PATH = dbPath;
  delete process.env.DATABASE_URL;
  delete process.env.DB_CLIENT;
  process.env.LOG_LEVEL = 'fatal'; // silence logs during tests

  closeDatabase();
  resetDatabaseAdapter();
  const db = getDatabase(dbPath);
  runMigrations(db);

  return {
    dbPath,
    db,
    cleanup: () => {
      closeDatabase();
      resetDatabaseAdapter();
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // ignore on windows locked files
      }
    },
  };
}
