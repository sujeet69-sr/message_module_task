import pg from 'pg';
import { getDatabasePool } from '../db/database.js';
import { MessageRecord, PaginationCursor } from '../models/types.js';

export class MessageRepository {
  private getPool(clientOrPool?: pg.Pool | pg.PoolClient): pg.Pool | pg.PoolClient {
    return clientOrPool || getDatabasePool();
  }

  public async create(message: MessageRecord, client?: pg.Pool | pg.PoolClient): Promise<MessageRecord> {
    const executor = this.getPool(client);
    const sql = `
      INSERT INTO messages (
        id, tenant_id, conversation_id, recipient_to, text,
        status, created_at, updated_at, queued_at, sent_at,
        delivered_at, read_at, failed_at, failure_reason, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;

    await executor.query(sql, [
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

  public async findById(id: string, client?: pg.Pool | pg.PoolClient): Promise<MessageRecord | null> {
    const executor = this.getPool(client);
    const res = await executor.query('SELECT * FROM messages WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  public async findByTenantAndId(
    tenantId: string,
    id: string,
    client?: pg.Pool | pg.PoolClient
  ): Promise<MessageRecord | null> {
    const executor = this.getPool(client);
    const res = await executor.query(
      'SELECT * FROM messages WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return res.rows[0] || null;
  }

  public async findConversationMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
    cursor?: PaginationCursor,
    client?: pg.Pool | pg.PoolClient
  ): Promise<MessageRecord[]> {
    const executor = this.getPool(client);
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
      const res = await executor.query(sql, [
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
    const res = await executor.query(sql, [tenantId, conversationId, queryLimit]);
    return res.rows;
  }

  public async updateWithOptimisticLock(
    id: string,
    updates: Partial<MessageRecord>,
    expectedVersion: number,
    client?: pg.Pool | pg.PoolClient
  ): Promise<boolean> {
    const executor = this.getPool(client);
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
    const res = await executor.query(sql, values);
    return (res.rowCount ?? 0) > 0;
  }

  public async updateDirect(
    id: string,
    updates: Partial<MessageRecord>,
    client?: pg.Pool | pg.PoolClient
  ): Promise<void> {
    const executor = this.getPool(client);
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
    await executor.query(sql, values);
  }
}

export const messageRepository = new MessageRepository();
