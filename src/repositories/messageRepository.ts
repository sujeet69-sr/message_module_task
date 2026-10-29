import { DatabaseSync } from 'node:sqlite';
import { getDatabaseAdapter } from '../db/adapter.js';
import { MessageRecord, PaginationCursor } from '../models/types.js';

export class MessageRepository {
  public async create(message: MessageRecord, _db?: DatabaseSync): Promise<MessageRecord> {
    return getDatabaseAdapter().createMessage(message);
  }

  public async findById(id: string, _db?: DatabaseSync): Promise<MessageRecord | null> {
    return getDatabaseAdapter().findMessageById(id);
  }

  public async findByTenantAndId(tenantId: string, id: string, _db?: DatabaseSync): Promise<MessageRecord | null> {
    return getDatabaseAdapter().findMessageByTenantAndId(tenantId, id);
  }

  public async findConversationMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
    cursor?: PaginationCursor,
    _db?: DatabaseSync
  ): Promise<MessageRecord[]> {
    return getDatabaseAdapter().findConversationMessages(tenantId, conversationId, limit, cursor);
  }

  public async updateWithOptimisticLock(
    id: string,
    updates: Partial<MessageRecord>,
    expectedVersion: number,
    _db?: DatabaseSync
  ): Promise<boolean> {
    return getDatabaseAdapter().updateMessageWithOptimisticLock(id, updates, expectedVersion);
  }

  public async updateDirect(
    id: string,
    updates: Partial<MessageRecord>,
    _db?: DatabaseSync
  ): Promise<void> {
    return getDatabaseAdapter().updateMessageDirect(id, updates);
  }
}

export const messageRepository = new MessageRepository();
