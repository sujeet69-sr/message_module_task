import pg from 'pg';
import { getDatabasePool } from '../db/database.js';
import { WebhookEventRecord } from '../models/types.js';

export class WebhookEventRepository {
  private getPool(clientOrPool?: pg.Pool | pg.PoolClient): pg.Pool | pg.PoolClient {
    return clientOrPool || getDatabasePool();
  }

  public async findByEventId(eventId: string, client?: pg.Pool | pg.PoolClient): Promise<WebhookEventRecord | null> {
    const executor = this.getPool(client);
    const res = await executor.query('SELECT * FROM webhook_events WHERE event_id = $1', [eventId]);
    return res.rows[0] || null;
  }

  public async create(event: WebhookEventRecord, client?: pg.Pool | pg.PoolClient): Promise<WebhookEventRecord> {
    const executor = this.getPool(client);
    const sql = `
      INSERT INTO webhook_events (
        event_id, message_id, status, occurred_at, received_at,
        processed_at, payload, outcome, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    await executor.query(sql, [
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

  public async findByMessageId(messageId: string, client?: pg.Pool | pg.PoolClient): Promise<WebhookEventRecord[]> {
    const executor = this.getPool(client);
    const res = await executor.query(
      'SELECT * FROM webhook_events WHERE message_id = $1 ORDER BY occurred_at ASC, received_at ASC',
      [messageId]
    );
    return res.rows;
  }
}

export const webhookEventRepository = new WebhookEventRepository();
