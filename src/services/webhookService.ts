import { DatabaseSync } from 'node:sqlite';
import { NotFoundError } from '../errors/AppError.js';
import {
  EventOutcome,
  MessageRecord,
  MessageStatus,
  WebhookEventRecord,
  WebhookStatus,
} from '../models/types.js';
import { messageRepository } from '../repositories/messageRepository.js';
import { webhookEventRepository } from '../repositories/webhookEventRepository.js';
import { logger } from '../utils/logger.js';
import { WebhookEventInput } from '../utils/validator.js';
import { metricsService } from './metricsService.js';

export const STATUS_RANK: Record<MessageStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: -1,
};

export interface TransitionDecision {
  shouldUpdateStatus: boolean;
  targetStatus: MessageStatus;
  outcome: EventOutcome;
  notes: string;
  timestampUpdates: {
    sent_at?: string;
    delivered_at?: string;
    read_at?: string;
    failed_at?: string;
  };
}

/**
 * Pure state machine evaluating status transition and timestamp reconciliation.
 */
export function evaluateStatusTransition(
  currentMessage: MessageRecord,
  incomingStatus: WebhookStatus,
  occurredAt: string
): TransitionDecision {
  const currentStatus = currentMessage.status;
  const timestampUpdates: TransitionDecision['timestampUpdates'] = {};

  // Always reconcile missing timestamps if an event for that stage arrives out-of-order
  if (incomingStatus === 'SENT' && !currentMessage.sent_at) {
    timestampUpdates.sent_at = occurredAt;
  } else if (incomingStatus === 'DELIVERED' && !currentMessage.delivered_at) {
    timestampUpdates.delivered_at = occurredAt;
  } else if (incomingStatus === 'READ' && !currentMessage.read_at) {
    timestampUpdates.read_at = occurredAt;
  } else if (incomingStatus === 'FAILED' && !currentMessage.failed_at) {
    timestampUpdates.failed_at = occurredAt;
  }

  // Rule 1: Terminal FAILED state cannot be resurrected
  if (currentStatus === 'FAILED') {
    return {
      shouldUpdateStatus: false,
      targetStatus: currentStatus,
      outcome: 'IGNORED_TERMINAL',
      notes: `Message is already in terminal state FAILED; ignoring incoming ${incomingStatus}`,
      timestampUpdates,
    };
  }

  // Rule 2: Handling incoming FAILED event
  if (incomingStatus === 'FAILED') {
    // A message cannot fail if it has already been DELIVERED or READ
    if (currentStatus === 'DELIVERED' || currentStatus === 'READ') {
      return {
        shouldUpdateStatus: false,
        targetStatus: currentStatus,
        outcome: 'IGNORED_OUT_OF_ORDER',
        notes: `Cannot transition message from ${currentStatus} to FAILED as delivery succeeded`,
        timestampUpdates,
      };
    }

    return {
      shouldUpdateStatus: true,
      targetStatus: 'FAILED',
      outcome: 'APPLIED',
      notes: `Message transitioned from ${currentStatus} to FAILED`,
      timestampUpdates,
    };
  }

  // Rule 3: Forward rank progression
  const currentRank = STATUS_RANK[currentStatus];
  const incomingRank = STATUS_RANK[incomingStatus];

  if (incomingRank > currentRank) {
    return {
      shouldUpdateStatus: true,
      targetStatus: incomingStatus,
      outcome: 'APPLIED',
      notes: `Forward status progression from ${currentStatus} to ${incomingStatus}`,
      timestampUpdates,
    };
  }

  // Rule 4: Out-of-order or duplicate lower-rank event (e.g. READ arrived before SENT)
  return {
    shouldUpdateStatus: false,
    targetStatus: currentStatus,
    outcome: 'IGNORED_OUT_OF_ORDER',
    notes: `Out-of-order event: current status ${currentStatus} (rank ${currentRank}) >= incoming ${incomingStatus} (rank ${incomingRank}). Status preserved.`,
    timestampUpdates,
  };
}

export interface WebhookProcessResult {
  eventId: string;
  messageId: string;
  status: WebhookStatus;
  outcome: EventOutcome;
  duplicate: boolean;
  messageStatus: MessageStatus;
  notes: string;
}

export class WebhookService {
  /**
   * Processes a provider webhook event idempotently within a database transaction.
   */
  public async processWebhookEvent(input: WebhookEventInput, db?: DatabaseSync): Promise<WebhookProcessResult> {
    const now = new Date().toISOString();

    // Step 1: Idempotency Check on eventId
    const existingEvent = await webhookEventRepository.findByEventId(input.eventId, db);
    if (existingEvent) {
      logger.info('Duplicate webhook event detected and ignored', {
        eventId: input.eventId,
        messageId: input.messageId,
        incomingStatus: input.status,
      });

      metricsService.recordDuplicateWebhook();

      const message = await messageRepository.findById(input.messageId, db);

      return {
        eventId: input.eventId,
        messageId: input.messageId,
        status: input.status,
        outcome: 'IGNORED_DUPLICATE',
        duplicate: true,
        messageStatus: message ? message.status : 'QUEUED',
        notes: 'Event already processed previously',
      };
    }

    // Step 2: Message Existence Check & Unmatched Event Strategy
    const message = await messageRepository.findById(input.messageId, db);
    if (!message) {
      logger.warn('Webhook event received for unknown message ID', {
        eventId: input.eventId,
        messageId: input.messageId,
        status: input.status,
      });

      // Persist unmatched event for audit trail / asynchronous reconciliation
      const unmatchedEvent: WebhookEventRecord = {
        event_id: input.eventId,
        message_id: input.messageId,
        status: input.status,
        occurred_at: input.occurredAt,
        received_at: now,
        processed_at: now,
        payload: JSON.stringify(input),
        outcome: 'UNMATCHED_MESSAGE',
        notes: `Message with ID ${input.messageId} does not exist in messages table`,
      };
      await webhookEventRepository.create(unmatchedEvent, db);
      metricsService.recordUnmatchedWebhook();

      throw new NotFoundError(`Message with ID ${input.messageId} was not found`);
    }

    // Step 3: Evaluate State Transition and Timestamps
    const decision = evaluateStatusTransition(message, input.status, input.occurredAt);

    // Persist the Webhook Event record
    const eventRecord: WebhookEventRecord = {
      event_id: input.eventId,
      message_id: input.messageId,
      status: input.status,
      occurred_at: input.occurredAt,
      received_at: now,
      processed_at: now,
      payload: JSON.stringify(input),
      outcome: decision.outcome,
      notes: decision.notes,
    };
    await webhookEventRepository.create(eventRecord, db);

    // Apply updates to Message record if required
    const updates: Partial<MessageRecord> = {
      updated_at: now,
      ...decision.timestampUpdates,
    };

    if (decision.shouldUpdateStatus) {
      updates.status = decision.targetStatus;
      if (input.failureReason) {
        updates.failure_reason = input.failureReason;
      }
    }

    // Perform optimistic concurrency update
    const updated = await messageRepository.updateWithOptimisticLock(
      message.id,
      updates,
      message.version,
      db
    );

    if (!updated) {
      logger.warn('Optimistic concurrency lock fallback to direct update in transaction', {
        messageId: message.id,
      });
      await messageRepository.updateDirect(message.id, updates, db);
    }

    logger.info('Webhook event processed successfully', {
      eventId: input.eventId,
      messageId: input.messageId,
      previousStatus: message.status,
      newStatus: decision.targetStatus,
      outcome: decision.outcome,
    });

    metricsService.recordWebhookProcessed(decision.outcome);

    return {
      eventId: input.eventId,
      messageId: input.messageId,
      status: input.status,
      outcome: decision.outcome,
      duplicate: false,
      messageStatus: decision.targetStatus,
      notes: decision.notes,
    };
  }
}

export const webhookService = new WebhookService();
