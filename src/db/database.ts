import pg from 'pg';
import { getEnvConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export function getDatabasePool(customConnectionString?: string): pg.Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const config = getEnvConfig();
  const connectionString = customConnectionString || config.DATABASE_URL;

  if (connectionString) {
    logger.info('Initializing PostgreSQL connection pool via connection string');
    poolInstance = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  } else {
    logger.info('Initializing PostgreSQL connection pool via environment variables', {
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

export async function closeDatabase(): Promise<void> {
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

export function resetDatabasePool(): void {
  poolInstance = null;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const pool = getDatabasePool();
    const result = await pool.query('SELECT 1 as alive;');
    return result.rows?.[0]?.alive === 1;
  } catch (err: any) {
    logger.error('PostgreSQL health check failed', { error: err.message });
    return false;
  }
}

export async function withTransaction<T>(
  action: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = getDatabasePool();
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
