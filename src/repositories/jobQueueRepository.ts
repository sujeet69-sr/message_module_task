import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db/database.js';
import { WorkerJobRecord } from '../models/types.js';

export class JobQueueRepository {
  private getDb(db?: DatabaseSync): DatabaseSync {
    return db || getDatabase();
  }

  public enqueue(queue: string, payload: unknown, maxAttempts: number = 3, db?: DatabaseSync): WorkerJobRecord {
    const activeDb = this.getDb(db);
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

    const stmt = activeDb.prepare(`
      INSERT INTO worker_jobs (
        id, queue, payload, status, attempts,
        max_attempts, next_run_at, error_message, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      job.id,
      job.queue,
      job.payload,
      job.status,
      job.attempts,
      job.max_attempts,
      job.next_run_at,
      job.error_message,
      job.created_at,
      job.updated_at
    );

    return job;
  }

  public fetchPendingJobs(queue: string, limit: number = 10, db?: DatabaseSync): WorkerJobRecord[] {
    const activeDb = this.getDb(db);
    const now = new Date().toISOString();

    const stmt = activeDb.prepare(`
      SELECT * FROM worker_jobs
      WHERE queue = ?
        AND status IN ('PENDING', 'FAILED')
        AND attempts < max_attempts
        AND next_run_at <= ?
      ORDER BY next_run_at ASC
      LIMIT ?
    `);

    const rows = stmt.all(queue, now, limit);
    return rows as unknown as WorkerJobRecord[];
  }

  public markProcessing(id: string, db?: DatabaseSync): boolean {
    const activeDb = this.getDb(db);
    const now = new Date().toISOString();

    const stmt = activeDb.prepare(`
      UPDATE worker_jobs
      SET status = 'PROCESSING',
          attempts = attempts + 1,
          updated_at = ?
      WHERE id = ? AND status IN ('PENDING', 'FAILED')
    `);

    const result = stmt.run(now, id) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  public markCompleted(id: string, db?: DatabaseSync): void {
    const activeDb = this.getDb(db);
    const now = new Date().toISOString();

    activeDb.prepare(`
      UPDATE worker_jobs
      SET status = 'COMPLETED',
          updated_at = ?
      WHERE id = ?
    `).run(now, id);
  }

  public markFailed(
    id: string,
    errorMessage: string,
    nextRunAt: string,
    isDeadLetter: boolean,
    db?: DatabaseSync
  ): void {
    const activeDb = this.getDb(db);
    const now = new Date().toISOString();
    const status = isDeadLetter ? 'DEAD_LETTER' : 'FAILED';

    activeDb.prepare(`
      UPDATE worker_jobs
      SET status = ?,
          error_message = ?,
          next_run_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(status, errorMessage, nextRunAt, now, id);
  }

  public getStats(db?: DatabaseSync): Record<string, number> {
    const activeDb = this.getDb(db);
    const rows = activeDb.prepare(`
      SELECT status, COUNT(*) as count
      FROM worker_jobs
      GROUP BY status
    `).all() as unknown as { status: string; count: number }[];

    const stats: Record<string, number> = {
      PENDING: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      FAILED: 0,
      DEAD_LETTER: 0,
    };

    for (const row of rows) {
      stats[row.status] = Number(row.count);
    }

    return stats;
  }
}

export const jobQueueRepository = new JobQueueRepository();
