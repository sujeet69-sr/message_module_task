import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ForbiddenError, NotFoundError } from '../errors/AppError.js';
import {
  MessageDTO,
  MessageRecord,
  PaginatedResult,
  WebhookEventDTO,
} from '../models/types.js';
import { messageRepository } from '../repositories/messageRepository.js';
import { webhookEventRepository } from '../repositories/webhookEventRepository.js';
import { decodeCursor, encodeCursor } from '../utils/pagination.js';
import {
  ConversationQueryInput,
  CreateMessageInput,
} from '../utils/validator.js';
import { metricsService } from './metricsService.js';
import { workerQueueService } from './workerQueue.js';

function toMessageDTO(record: MessageRecord, history?: WebhookEventDTO[]): MessageDTO {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    conversationId: record.conversation_id,
    to: record.recipient_to,
    text: record.text,
    status: record.status,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    timestamps: {
      queuedAt: record.queued_at,
      sentAt: record.sent_at,
      deliveredAt: record.delivered_at,
      readAt: record.read_at,
      failedAt: record.failed_at,
    },
    failureReason: record.failure_reason,
    history,
  };
}

export class MessageService {
  /**
   * Creates a new message with QUEUED status and persists it.
   */
  public createMessage(
    input: CreateMessageInput,
    authenticatedTenantId?: string,
    db?: DatabaseSync
  ): MessageDTO {
    // If an authenticated tenant is specified via x-tenant-id header, enforce match
    if (authenticatedTenantId && authenticatedTenantId !== input.tenantId) {
      throw new ForbiddenError(
        `Authenticated tenant '${authenticatedTenantId}' cannot create messages for tenant '${input.tenantId}'`
      );
    }

    const now = new Date().toISOString();
    const id = `msg-${crypto.randomUUID().slice(0, 12)}`;

    const record: MessageRecord = {
      id,
      tenant_id: input.tenantId,
      conversation_id: input.conversationId,
      recipient_to: input.to,
      text: input.text,
      status: 'QUEUED',
      created_at: now,
      updated_at: now,
      queued_at: now,
      sent_at: null,
      delivered_at: null,
      read_at: null,
      failed_at: null,
      failure_reason: null,
      version: 1,
    };

    messageRepository.create(record, db);
    metricsService.recordMessageCreated();

    // Enqueue message dispatch job to worker queue for asynchronous processing
    try {
      workerQueueService.enqueue('message-dispatch', {
        messageId: id,
        tenantId: input.tenantId,
        to: input.to,
        createdAt: now,
      });
    } catch {
      // In-process worker queue failure shouldn't abort message creation
    }

    return toMessageDTO(record);
  }

  /**
   * Retrieves message details and webhook event history with tenant isolation.
   */
  public getMessage(messageId: string, tenantId?: string, db?: DatabaseSync): MessageDTO {
    const record = messageRepository.findById(messageId, db);
    if (!record) {
      throw new NotFoundError(`Message with ID '${messageId}' was not found`);
    }

    // Enforce tenant isolation if tenant is specified
    if (tenantId && record.tenant_id !== tenantId) {
      throw new NotFoundError(`Message with ID '${messageId}' was not found`);
    }

    const events = webhookEventRepository.findByMessageId(messageId, db);
    const history: WebhookEventDTO[] = events.map((e) => ({
      eventId: e.event_id,
      messageId: e.message_id,
      status: e.status,
      occurredAt: e.occurred_at,
      receivedAt: e.received_at,
      outcome: e.outcome,
      notes: e.notes,
    }));

    return toMessageDTO(record, history);
  }

  /**
   * Retrieves paginated messages for a conversation in stable chronological order.
   */
  public getConversationMessages(
    tenantId: string,
    conversationId: string,
    query: ConversationQueryInput,
    db?: DatabaseSync
  ): PaginatedResult<MessageDTO> {
    const limit = query.limit || 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const rows = messageRepository.findConversationMessages(
      tenantId,
      conversationId,
      limit,
      cursor,
      db
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor({
        createdAt: lastItem.created_at,
        id: lastItem.id,
      });
    }

    return {
      items: items.map((r) => toMessageDTO(r)),
      nextCursor,
      hasMore,
      limit,
    };
  }
}

export const messageService = new MessageService();
