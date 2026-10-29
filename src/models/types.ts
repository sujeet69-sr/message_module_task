export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export type WebhookStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export type EventOutcome =
  | 'APPLIED'
  | 'IGNORED_DUPLICATE'
  | 'IGNORED_OUT_OF_ORDER'
  | 'IGNORED_TERMINAL'
  | 'UNMATCHED_MESSAGE';

export interface MessageRecord {
  id: string;
  tenant_id: string;
  conversation_id: string;
  recipient_to: string;
  text: string;
  status: MessageStatus;
  created_at: string;
  updated_at: string;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  version: number;
}

export interface MessageTimestamps {
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
}

export interface MessageDTO {
  id: string;
  tenantId: string;
  conversationId: string;
  to: string;
  text: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
  timestamps: MessageTimestamps;
  failureReason?: string | null;
  history?: WebhookEventDTO[];
}

export interface WebhookEventRecord {
  event_id: string;
  message_id: string;
  status: WebhookStatus;
  occurred_at: string;
  received_at: string;
  processed_at: string | null;
  payload: string;
  outcome: EventOutcome;
  notes: string | null;
}

export interface WebhookEventDTO {
  eventId: string;
  messageId: string;
  status: WebhookStatus;
  occurredAt: string;
  receivedAt: string;
  outcome: EventOutcome;
  notes?: string | null;
}

export interface WorkerJobRecord {
  id: string;
  queue: string;
  payload: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginationCursor {
  createdAt: string;
  id: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}
