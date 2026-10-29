import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { getEnvConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export function getPostgresPool(): pg.Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const config = getEnvConfig();

  if (config.DATABASE_URL) {
    logger.info('Initializing PostgreSQL connection pool via DATABASE_URL');
    poolInstance = new Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  } else {
    logger.info('Initializing PostgreSQL connection pool via individual variables', {
      host: config.PGHOST,
      port: config.PGPORT,
      user: config.PGUSER,
      database: config.PGDATABASE,
    });
    poolInstance = new Pool({
      host: config.PGHOST,
      port: config.PGPORT,
      user: config.PGUSER,
      password: config.PGPASSWORD,
      database: config.PGDATABASE,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  poolInstance.on('error', (err) => {
    logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
  });

  return poolInstance;
}

export async function closePostgres(): Promise<void> {
  if (poolInstance) {
    try {
      await poolInstance.end();
      logger.info('PostgreSQL connection pool closed');
    } catch (err: any) {
      logger.error('Error closing PostgreSQL pool', { error: err.message });
    } finally {
      poolInstance = null;
    }
  }
}

export async function checkPostgresHealth(): Promise<boolean> {
  try {
    const pool = getPostgresPool();
    const result = await pool.query('SELECT 1 as alive;');
    return result.rows?.[0]?.alive === 1;
  } catch (err: any) {
    logger.error('PostgreSQL health check failed', { error: err.message });
    return false;
  }
}

export async function withPostgresTransaction<T>(
  action: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr: any) {
      logger.error('Failed to rollback PostgreSQL transaction', { error: rollbackErr.message });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function runPostgresMigrations(): Promise<void> {
  const pool = getPostgresPool();

  // 1. Ensure schema_migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
    );
  `);

  // 2. Read migration file
  const migrationFile = path.resolve(__dirname, '../../migrations/001_postgres_schema.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');

  // Check if version 1 already applied
  const existing = await pool.query('SELECT version FROM schema_migrations WHERE version = $1', [1]);
  if (existing.rows.length === 0) {
    await withPostgresTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)',
        [1, '001_postgres_schema.sql', new Date().toISOString()]
      );
    });
    logger.info('[PostgreSQL Migrations] Applied migration: 001_postgres_schema.sql');
  }
}
