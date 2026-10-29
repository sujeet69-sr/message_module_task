import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { isPostgres } from '../config/env.js';
import {
  MessageRecord,
  PaginationCursor,
  WebhookEventRecord,
  WorkerJobRecord,
} from '../models/types.js';
import { logger } from '../utils/logger.js';
import { checkDatabaseHealth, closeDatabase, getDatabase, withTransaction } from './database.js';
import {
  checkPostgresHealth,
  closePostgres,
  getPostgresPool,
  withPostgresTransaction,
} from './postgres.js';

export interface IDatabaseAdapter {
  createMessage(message: MessageRecord): Promise<MessageRecord>;
  findMessageById(id: string): Promise<MessageRecord | null>;
  findMessageByTenantAndId(tenantId: string, id: string): Promise<MessageRecord | null>;
  findConversationMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
    cursor?: PaginationCursor
  ): Promise<MessageRecord[]>;
  updateMessageWithOptimisticLock(
    id: string,
    updates: Partial<MessageRecord>,
    expectedVersion: number
  ): Promise<boolean>;
  updateMessageDirect(id: string, updates: Partial<MessageRecord>): Promise<void>;

  findWebhookEventByEventId(eventId: string): Promise<WebhookEventRecord | null>;
  createWebhookEvent(event: WebhookEventRecord): Promise<WebhookEventRecord>;
  findWebhookEventsByMessageId(messageId: string): Promise<WebhookEventRecord[]>;

  enqueueWorkerJob(queue: string, payload: unknown, maxAttempts: number): Promise<WorkerJobRecord>;
  fetchPendingWorkerJobs(queue: string, limit: number): Promise<WorkerJobRecord[]>;
  markWorkerJobProcessing(id: string): Promise<boolean>;
  markWorkerJobCompleted(id: string): Promise<void>;
  markWorkerJobFailed(
    id: string,
    errorMessage: string,
    nextRunAt: string,
    isDeadLetter: boolean
  ): Promise<void>;
  getWorkerJobStats(): Promise<Record<string, number>>;

  checkHealth(): Promise<{ status: boolean; engine: 'sqlite' | 'postgresql' }>;
  close(): Promise<void>;
}

// -------------------------------------------------------------
// SQLite Implementation (Synchronous wrapped in Promise)
// -------------------------------------------------------------
export class SQLiteAdapter implements IDatabaseAdapter {
  private getDb(): DatabaseSync {
    return getDatabase();
  }

  public async createMessage(message: MessageRecord): Promise<MessageRecord> {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO messages (
        id, tenant_id, conversation_id, recipient_to, text,
        status, created_at, updated_at, queued_at, sent_at,
        delivered_at, read_at, failed_at, failure_reason, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      message.tenant_id,
      message.conversation_id,
      message.recipient_to,
      message.text,
      message.status,
      message.created_at,
      message.updated_at,
      message.queued_at,
      message.sent_at,
      message.delivered_at,
      message.read_at,
      message.failed_at,
      message.failure_reason,
      message.version
    );

    return message;
  }

  public async findMessageById(id: string): Promise<MessageRecord | null> {
    const row = this.getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id);
    return (row as unknown as MessageRecord) || null;
  }

  public async findMessageByTenantAndId(tenantId: string, id: string): Promise<MessageRecord | null> {
    const row = this.getDb()
      .prepare('SELECT * FROM messages WHERE tenant_id = ? AND id = ?')
      .get(tenantId, id);
    return (row as unknown as MessageRecord) || null;
  }

  public async findConversationMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
    cursor?: PaginationCursor
  ): Promise<MessageRecord[]> {
    const db = this.getDb();
    const queryLimit = limit + 1;

    if (cursor) {
      const stmt = db.prepare(`
        SELECT * FROM messages
        WHERE tenant_id = ?
          AND conversation_id = ?
          AND (created_at > ? OR (created_at = ? AND id > ?))
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `);
      const rows = stmt.all(tenantId, conversationId, cursor.createdAt, cursor.createdAt, cursor.id, queryLimit);
      return rows as unknown as MessageRecord[];
    }

    const stmt = db.prepare(`
      SELECT * FROM messages
      WHERE tenant_id = ?
        AND conversation_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `);
    const rows = stmt.all(tenantId, conversationId, queryLimit);
    return rows as unknown as MessageRecord[];
  }

  public async updateMessageWithOptimisticLock(
    id: string,
    updates: Partial<MessageRecord>,
    expectedVersion: number
  ): Promise<boolean> {
    const db = this.getDb();
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, val] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'version') {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }

    fields.push('version = version + 1');
    values.push(id);
    values.push(expectedVersion);

    const sql = `UPDATE messages SET ${fields.join(', ')} WHERE id = ? AND version = ?`;
    const result = db.prepare(sql).run(...values) as { changes?: number };

    return (result.changes ?? 0) > 0;
  }

  public async updateMessageDirect(id: string, updates: Partial<MessageRecord>): Promise<void> {
    const db = this.getDb();
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, val] of Object.entries(updates)) {
      if (key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }

    values.push(id);
    const sql = `UPDATE messages SET ${fields.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);
  }

  public async findWebhookEventByEventId(eventId: string): Promise<WebhookEventRecord | null> {
    const row = this.getDb().prepare('SELECT * FROM webhook_events WHERE event_id = ?').get(eventId);
    return (row as unknown as WebhookEventRecord) || null;
  }

  public async createWebhookEvent(event: WebhookEventRecord): Promise<WebhookEventRecord> {
    const stmt = this.getDb().prepare(`
      INSERT INTO webhook_events (
        event_id, message_id, status, occurred_at, received_at,
        processed_at, payload, outcome, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.event_id,
      event.message_id,
      event.status,
      event.occurred_at,
      event.received_at,
      event.processed_at,
      event.payload,
      event.outcome,
      event.notes
    );

    return event;
  }

  public async findWebhookEventsByMessageId(messageId: string): Promise<WebhookEventRecord[]> {
    const rows = this.getDb()
      .prepare('SELECT * FROM webhook_events WHERE message_id = ? ORDER BY occurred_at ASC, received_at ASC')
      .all(messageId);
    return rows as unknown as WebhookEventRecord[];
  }

  public async enqueueWorkerJob(queue: string, payload: unknown, maxAttempts: number): Promise<WorkerJobRecord> {
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

    this.getDb().prepare(`
      INSERT INTO worker_jobs (
        id, queue, payload, status, attempts,
        max_attempts, next_run_at, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

  public async fetchPendingWorkerJobs(queue: string, limit: number): Promise<WorkerJobRecord[]> {
    const now = new Date().toISOString();
    const rows = this.getDb().prepare(`
      SELECT * FROM worker_jobs
      WHERE queue = ?
        AND status IN ('PENDING', 'FAILED')
        AND attempts < max_attempts
        AND next_run_at <= ?
      ORDER BY next_run_at ASC
      LIMIT ?
    `).all(queue, now, limit);

    return rows as unknown as WorkerJobRecord[];
  }

  public async markWorkerJobProcessing(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const stmt = this.getDb().prepare(`
      UPDATE worker_jobs
      SET status = 'PROCESSING',
          attempts = attempts + 1,
          updated_at = ?
      WHERE id = ? AND status IN ('PENDING', 'FAILED')
    `);

    const result = stmt.run(now, id) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  public async markWorkerJobCompleted(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.getDb().prepare(`
      UPDATE worker_jobs
      SET status = 'COMPLETED',
          updated_at = ?
      WHERE id = ?
    `).run(now, id);
  }

  public async markWorkerJobFailed(
    id: string,
    errorMessage: string,
    nextRunAt: string,
    isDeadLetter: boolean
  ): Promise<void> {
    const now = new Date().toISOString();
    const status = isDeadLetter ? 'DEAD_LETTER' : 'FAILED';
    this.getDb().prepare(`
      UPDATE worker_jobs
      SET status = ?,
          error_message = ?,
          next_run_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(status, errorMessage, nextRunAt, now, id);
  }

  public async getWorkerJobStats(): Promise<Record<string, number>> {
    const rows = this.getDb().prepare(`
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

  public async checkHealth(): Promise<{ status: boolean; engine: 'sqlite' | 'postgresql' }> {
    return { status: checkDatabaseHealth(), engine: 'sqlite' };
  }

  public async close(): Promise<void> {
    closeDatabase();
  }
}

// -------------------------------------------------------------
// PostgreSQL Implementation
// -------------------------------------------------------------
export class PostgresAdapter implements IDatabaseAdapter {
  private getPool(): pg.Pool {
    return getPostgresPool();
  }

  public async createMessage(message: MessageRecord): Promise<MessageRecord> {
    const sql = `
      INSERT INTO messages (
        id, tenant_id, conversation_id, recipient_to, text,
        status, created_at, updated_at, queued_at, sent_at,
        delivered_at, read_at, failed_at, failure_reason, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;

    await this.getPool().query(sql, [
      message.id,
      message.tenant_id,
      message.conversation_id,
      message.recipient_to,
      message.text,
      message.status,
      message.created_at,
      message.updated_at,
      message.queued_at,
      message.sent_at,
      message.delivered_at,
      message.read_at,
      message.failed_at,
      message.failure_reason,
      message.version,
    ]);

    return message;
  }

  public async findMessageById(id: string): Promise<MessageRecord | null> {
    const res = await this.getPool().query('SELECT * FROM messages WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  public async findMessageByTenantAndId(tenantId: string, id: string): Promise<MessageRecord | null> {
    const res = await this.getPool().query(
      'SELECT * FROM messages WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return res.rows[0] || null;
  }

  public async findConversationMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
    cursor?: PaginationCursor
  ): Promise<MessageRecord[]> {
    const queryLimit = limit + 1;

    if (cursor) {
      const sql = `
        SELECT * FROM messages
        WHERE tenant_id = $1
          AND conversation_id = $2
          AND (created_at > $3 OR (created_at = $4 AND id > $5))
        ORDER BY created_at ASC, id ASC
        LIMIT $6
      `;
      const res = await this.getPool().query(sql, [
        tenantId,
        conversationId,
        cursor.createdAt,
        cursor.createdAt,
        cursor.id,
        queryLimit,
      ]);
      return res.rows;
    }

    const sql = `
      SELECT * FROM messages
      WHERE tenant_id = $1
        AND conversation_id = $2
      ORDER BY created_at ASC, id ASC
      LIMIT $3
    `;
    const res = await this.getPool().query(sql, [tenantId, conversationId, queryLimit]);
    return res.rows;
  }

  public async updateMessageWithOptimisticLock(
    id: string,
    updates: Partial<MessageRecord>,
    expectedVersion: number
  ): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'version') {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }

    fields.push('version = version + 1');
    values.push(id);
    const idIdx = idx++;
    values.push(expectedVersion);
    const verIdx = idx++;

    const sql = `UPDATE messages SET ${fields.join(', ')} WHERE id = $${idIdx} AND version = $${verIdx}`;
    const res = await this.getPool().query(sql, values);
    return (res.rowCount ?? 0) > 0;
  }

  public async updateMessageDirect(id: string, updates: Partial<MessageRecord>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
      if (key !== 'id') {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }

    values.push(id);
    const sql = `UPDATE messages SET ${fields.join(', ')} WHERE id = $${idx}`;
    await this.getPool().query(sql, values);
  }

  public async findWebhookEventByEventId(eventId: string): Promise<WebhookEventRecord | null> {
    const res = await this.getPool().query('SELECT * FROM webhook_events WHERE event_id = $1', [eventId]);
    return res.rows[0] || null;
  }

  public async createWebhookEvent(event: WebhookEventRecord): Promise<WebhookEventRecord> {
    const sql = `
      INSERT INTO webhook_events (
        event_id, message_id, status, occurred_at, received_at,
        processed_at, payload, outcome, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    await this.getPool().query(sql, [
      event.event_id,
      event.message_id,
      event.status,
      event.occurred_at,
      event.received_at,
      event.processed_at,
      event.payload,
      event.outcome,
      event.notes,
    ]);

    return event;
  }

  public async findWebhookEventsByMessageId(messageId: string): Promise<WebhookEventRecord[]> {
    const res = await this.getPool().query(
      'SELECT * FROM webhook_events WHERE message_id = $1 ORDER BY occurred_at ASC, received_at ASC',
      [messageId]
    );
    return res.rows;
  }

  public async enqueueWorkerJob(queue: string, payload: unknown, maxAttempts: number): Promise<WorkerJobRecord> {
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

    await this.getPool().query(sql, [
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

  public async fetchPendingWorkerJobs(queue: string, limit: number): Promise<WorkerJobRecord[]> {
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

    const res = await this.getPool().query(sql, [queue, now, limit]);
    return res.rows;
  }

  public async markWorkerJobProcessing(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const sql = `
      UPDATE worker_jobs
      SET status = 'PROCESSING',
          attempts = attempts + 1,
          updated_at = $1
      WHERE id = $2 AND status IN ('PENDING', 'FAILED')
    `;

    const res = await this.getPool().query(sql, [now, id]);
    return (res.rowCount ?? 0) > 0;
  }

  public async markWorkerJobCompleted(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.getPool().query(
      `UPDATE worker_jobs SET status = 'COMPLETED', updated_at = $1 WHERE id = $2`,
      [now, id]
    );
  }

  public async markWorkerJobFailed(
    id: string,
    errorMessage: string,
    nextRunAt: string,
    isDeadLetter: boolean
  ): Promise<void> {
    const now = new Date().toISOString();
    const status = isDeadLetter ? 'DEAD_LETTER' : 'FAILED';
    await this.getPool().query(
      `UPDATE worker_jobs SET status = $1, error_message = $2, next_run_at = $3, updated_at = $4 WHERE id = $5`,
      [status, errorMessage, nextRunAt, now, id]
    );
  }

  public async getWorkerJobStats(): Promise<Record<string, number>> {
    const res = await this.getPool().query(`
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

  public async checkHealth(): Promise<{ status: boolean; engine: 'sqlite' | 'postgresql' }> {
    const alive = await checkPostgresHealth();
    return { status: alive, engine: 'postgresql' };
  }

  public async close(): Promise<void> {
    await closePostgres();
  }
}

// -------------------------------------------------------------
// Factory & Active Adapter Singleton
// -------------------------------------------------------------
let activeAdapter: IDatabaseAdapter | null = null;

export function getDatabaseAdapter(): IDatabaseAdapter {
  if (activeAdapter) {
    return activeAdapter;
  }

  if (isPostgres()) {
    logger.info('Using PostgreSQL database adapter');
    activeAdapter = new PostgresAdapter();
  } else {
    logger.info('Using SQLite database adapter');
    activeAdapter = new SQLiteAdapter();
  }

  return activeAdapter;
}

export function resetDatabaseAdapter(): void {
  activeAdapter = null;
}
