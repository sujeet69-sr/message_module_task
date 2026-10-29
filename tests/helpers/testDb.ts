import pg from 'pg';
import { runMigrations } from '../../migrations/migrate.js';
import { closeDatabase, getDatabasePool, resetDatabasePool } from '../../src/db/database.js';

export interface TestDbContext {
  pool: pg.Pool;
  cleanup: () => Promise<void>;
  truncateTables: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDbContext> {
  // Use messaging_db_test or configured test database
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal'; // silence logs during tests
  process.env.PGDATABASE = process.env.TEST_PGDATABASE || 'messaging_db_test';
  process.env.PGUSER = process.env.PGUSER || 'postgres';
  process.env.PGPASSWORD = process.env.PGPASSWORD || 'password';
  process.env.PGHOST = process.env.PGHOST || 'localhost';
  process.env.PGPORT = process.env.PGPORT || '5432';

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
  }

  await closeDatabase();
  resetDatabasePool();

  const pool = getDatabasePool();
  await runMigrations(pool);

  // Truncate tables for a clean slate
  await pool.query('TRUNCATE TABLE messages, webhook_events, worker_jobs CASCADE;');

  return {
    pool,
    truncateTables: async () => {
      await pool.query('TRUNCATE TABLE messages, webhook_events, worker_jobs CASCADE;');
    },
    cleanup: async () => {
      await pool.query('TRUNCATE TABLE messages, webhook_events, worker_jobs CASCADE;');
      await closeDatabase();
      resetDatabasePool();
    },
  };
}
