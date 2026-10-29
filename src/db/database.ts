import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getEnvConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function getDatabase(customPath?: string): DatabaseSync {
  const targetPath = customPath || getEnvConfig().DATABASE_PATH;

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
  }

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  logger.info('Opening SQLite database connection', { path: targetPath });
  const db = new DatabaseSync(targetPath);

  // Configure SQLite for high concurrency and integrity
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  dbInstance = db;
  currentDbPath = targetPath;

  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (err: any) {
      logger.error('Error closing database', { error: err.message });
    } finally {
      dbInstance = null;
      currentDbPath = null;
    }
  }
}

export function withTransaction<T>(action: (db: DatabaseSync) => T, db?: DatabaseSync): T {
  const activeDb = db || getDatabase();
  activeDb.exec('BEGIN IMMEDIATE;');
  try {
    const result = action(activeDb);
    activeDb.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      activeDb.exec('ROLLBACK;');
    } catch (rollbackErr: any) {
      logger.error('Failed to rollback transaction', { error: rollbackErr.message });
    }
    throw error;
  }
}

export function checkDatabaseHealth(db?: DatabaseSync): boolean {
  try {
    const activeDb = db || getDatabase();
    const result = activeDb.prepare('SELECT 1 as alive;').get() as { alive?: number } | undefined;
    return result?.alive === 1;
  } catch (err: any) {
    logger.error('Database health check failed', { error: err.message });
    return false;
  }
}
