import { DatabaseSync } from 'node:sqlite';
import { getDatabaseAdapter } from '../db/adapter.js';
import { WebhookEventRecord } from '../models/types.js';

export class WebhookEventRepository {
  public async findByEventId(eventId: string, _db?: DatabaseSync): Promise<WebhookEventRecord | null> {
    return getDatabaseAdapter().findWebhookEventByEventId(eventId);
  }

  public async create(event: WebhookEventRecord, _db?: DatabaseSync): Promise<WebhookEventRecord> {
    return getDatabaseAdapter().createWebhookEvent(event);
  }

  public async findByMessageId(messageId: string, _db?: DatabaseSync): Promise<WebhookEventRecord[]> {
    return getDatabaseAdapter().findWebhookEventsByMessageId(messageId);
  }
}

export const webhookEventRepository = new WebhookEventRepository();
