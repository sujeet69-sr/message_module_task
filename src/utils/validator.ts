import { z } from 'zod';

export const CreateMessageSchema = z.object({
  tenantId: z
    .string({ required_error: 'tenantId is required' })
    .trim()
    .min(1, 'tenantId cannot be empty')
    .max(64, 'tenantId cannot exceed 64 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'tenantId must only contain alphanumeric characters, hyphens, and underscores'),
  conversationId: z
    .string({ required_error: 'conversationId is required' })
    .trim()
    .min(1, 'conversationId cannot be empty')
    .max(128, 'conversationId cannot exceed 128 characters'),
  to: z
    .string({ required_error: 'to is required' })
    .trim()
    .min(3, 'Recipient "to" must have at least 3 characters')
    .max(32, 'Recipient "to" cannot exceed 32 characters')
    .regex(/^\+?[1-9]\d{1,14}$/, 'Recipient "to" must be a valid E.164 phone number (e.g. +919876543210)'),
  text: z
    .string({ required_error: 'text is required' })
    .min(1, 'text cannot be empty')
    .max(4096, 'text cannot exceed 4096 characters'),
});

export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

export const WebhookEventSchema = z.object({
  eventId: z
    .string({ required_error: 'eventId is required' })
    .trim()
    .min(1, 'eventId cannot be empty')
    .max(128, 'eventId cannot exceed 128 characters'),
  messageId: z
    .string({ required_error: 'messageId is required' })
    .trim()
    .min(1, 'messageId cannot be empty')
    .max(128, 'messageId cannot exceed 128 characters'),
  status: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED'], {
    errorMap: () => ({
      message: 'status must be one of: SENT, DELIVERED, READ, FAILED',
    }),
  }),
  occurredAt: z
    .string({ required_error: 'occurredAt is required' })
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'occurredAt must be a valid ISO 8601 date string',
    }),
  failureReason: z.string().max(256).optional(),
});

export type WebhookEventInput = z.infer<typeof WebhookEventSchema>;

export const ConversationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ConversationQueryInput = z.infer<typeof ConversationQuerySchema>;
