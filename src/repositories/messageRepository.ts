import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db/database.js';
import { MessageRecord, PaginationCursor } from '../models/types.js';

export class MessageRepository {
  private getDb(db?: DatabaseSync): DatabaseSync {
    return db || getDatabase();
  }

  public create(message: MessageRecord, db?: DatabaseSync): MessageRecord {
    const activeDb = this.getDb(db);
    const stmt = activeDb.prepare(`
      INSERT INTO messages (
        id, tenant_id, conversation_id, recipient_to, text,
        status, created_at, updated_at, queued_at, sent_at,
        delivered_at, read_at, failed_at, failure_reason, version
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
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

  public findById(id: string, db?: DatabaseSync): MessageRecord | null {
    const activeDb = this.getDb(db);
    const row = activeDb.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    return (row as unknown as MessageRecord) || null;
  }

  public findByTenantAndId(tenantId: string, id: string, db?: DatabaseSync): MessageRecord | null {
    const activeDb = this.getDb(db);
    const row = activeDb
      .prepare('SELECT * FROM messages WHERE tenant_id = ? AND id = ?')
      .get(tenantId, id);
    return (row as unknown as MessageRecord) || null;
  }

  public findConversationMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
    cursor?: PaginationCursor,
    db?: DatabaseSync
  ): MessageRecord[] {
    const activeDb = this.getDb(db);
    const queryLimit = limit + 1; // Fetch 1 extra to determine hasMore

    if (cursor) {
      const stmt = activeDb.prepare(`
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

    const stmt = activeDb.prepare(`
      SELECT * FROM messages
      WHERE tenant_id = ?
        AND conversation_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `);
    const rows = stmt.all(tenantId, conversationId, queryLimit);
    return rows as unknown as MessageRecord[];
  }

  public updateWithOptimisticLock(
    id: string,
    updates: Partial<MessageRecord>,
    expectedVersion: number,
    db?: DatabaseSync
  ): boolean {
    const activeDb = this.getDb(db);
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
    const stmt = activeDb.prepare(sql);
    const result = stmt.run(...values) as { changes?: number };

    return (result.changes ?? 0) > 0;
  }

  public updateDirect(
    id: string,
    updates: Partial<MessageRecord>,
    db?: DatabaseSync
  ): void {
    const activeDb = this.getDb(db);
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
    activeDb.prepare(sql).run(...values);
  }
}

export const messageRepository = new MessageRepository();
