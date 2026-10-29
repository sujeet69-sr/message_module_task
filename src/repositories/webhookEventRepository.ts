import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db/database.js';
import { WebhookEventRecord } from '../models/types.js';

export class WebhookEventRepository {
  private getDb(db?: DatabaseSync): DatabaseSync {
    return db || getDatabase();
  }

  public findByEventId(eventId: string, db?: DatabaseSync): WebhookEventRecord | null {
    const activeDb = this.getDb(db);
    const row = activeDb.prepare('SELECT * FROM webhook_events WHERE event_id = ?').get(eventId);
    return (row as unknown as WebhookEventRecord) || null;
  }

  public create(event: WebhookEventRecord, db?: DatabaseSync): WebhookEventRecord {
    const activeDb = this.getDb(db);
    const stmt = activeDb.prepare(`
      INSERT INTO webhook_events (
        event_id, message_id, status, occurred_at, received_at,
        processed_at, payload, outcome, notes
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
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

  public findByMessageId(messageId: string, db?: DatabaseSync): WebhookEventRecord[] {
    const activeDb = this.getDb(db);
    const stmt = activeDb.prepare(`
      SELECT * FROM webhook_events
      WHERE message_id = ?
      ORDER BY occurred_at ASC, received_at ASC
    `);
    const rows = stmt.all(messageId);
    return rows as unknown as WebhookEventRecord[];
  }
}

export const webhookEventRepository = new WebhookEventRepository();
