import crypto from 'node:crypto';
import pg from 'pg';
import { getDatabasePool } from '../db/database.js';
import { WorkerJobRecord } from '../models/types.js';

export class JobQueueRepository {
  private getPool(clientOrPool?: pg.Pool | pg.PoolClient): pg.Pool | pg.PoolClient {
    return clientOrPool || getDatabasePool();
  }

  public async enqueue(
    queue: string,
    payload: unknown,
    maxAttempts: number = 3,
    client?: pg.Pool | pg.PoolClient
  ): Promise<WorkerJobRecord> {
    const executor = this.getPool(client);
    const now = new Date().toISOString();
    const id = `job_${crypto.randomUUID()}`;

    const job: WorkerJobRecord = {
      id,
      queue,
      payload: JSON.stringify(payload),
      status: 'PENDING',
      attempts: 0,
      max_attempts: maxAttempts,
      next_run_at: now,
      error_message: null,
      created_at: now,
      updated_at: now,
    };

    const sql = `
      INSERT INTO worker_jobs (
        id, queue, payload, status, attempts,
        max_attempts, next_run_at, error_message, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    await executor.query(sql, [
      job.id,
      job.queue,
      job.payload,
      job.status,
      job.attempts,
      job.max_attempts,
      job.next_run_at,
      job.error_message,
      job.created_at,
      job.updated_at,
    ]);

    return job;
  }

  public async fetchPendingJobs(
    queue: string,
    limit: number = 10,
    client?: pg.Pool | pg.PoolClient
  ): Promise<WorkerJobRecord[]> {
    const executor = this.getPool(client);
    const now = new Date().toISOString();
    const sql = `
      SELECT * FROM worker_jobs
      WHERE queue = $1
        AND status IN ('PENDING', 'FAILED')
        AND attempts < max_attempts
        AND next_run_at <= $2
      ORDER BY next_run_at ASC
      LIMIT $3
    `;

    const res = await executor.query(sql, [queue, now, limit]);
    return res.rows;
  }

  public async markProcessing(id: string, client?: pg.Pool | pg.PoolClient): Promise<boolean> {
    const executor = this.getPool(client);
    const now = new Date().toISOString();
    const sql = `
      UPDATE worker_jobs
      SET status = 'PROCESSING',
          attempts = attempts + 1,
          updated_at = $1
      WHERE id = $2 AND status IN ('PENDING', 'FAILED')
    `;

    const res = await executor.query(sql, [now, id]);
    return (res.rowCount ?? 0) > 0;
  }

  public async markCompleted(id: string, client?: pg.Pool | pg.PoolClient): Promise<void> {
    const executor = this.getPool(client);
    const now = new Date().toISOString();
    await executor.query(
      `UPDATE worker_jobs SET status = 'COMPLETED', updated_at = $1 WHERE id = $2`,
      [now, id]
    );
  }

  public async markFailed(
    id: string,
    errorMessage: string,
    nextRunAt: string,
    isDeadLetter: boolean,
    client?: pg.Pool | pg.PoolClient
  ): Promise<void> {
    const executor = this.getPool(client);
    const now = new Date().toISOString();
    const status = isDeadLetter ? 'DEAD_LETTER' : 'FAILED';
    await executor.query(
      `UPDATE worker_jobs SET status = $1, error_message = $2, next_run_at = $3, updated_at = $4 WHERE id = $5`,
      [status, errorMessage, nextRunAt, now, id]
    );
  }

  public async getStats(client?: pg.Pool | pg.PoolClient): Promise<Record<string, number>> {
    const executor = this.getPool(client);
    const res = await executor.query(`
      SELECT status, COUNT(*) as count
      FROM worker_jobs
      GROUP BY status
    `);

    const stats: Record<string, number> = {
      PENDING: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      FAILED: 0,
      DEAD_LETTER: 0,
    };

    for (const row of res.rows) {
      stats[row.status] = Number(row.count);
    }

    return stats;
  }
}

export const jobQueueRepository = new JobQueueRepository();
