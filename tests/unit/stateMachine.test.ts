import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MessageRecord } from '../../src/models/types.js';
import { evaluateStatusTransition } from '../../src/services/webhookService.js';

describe('State Machine & Status Transitions Unit Tests', () => {
  const baseMessage: MessageRecord = {
    id: 'msg-1',
    tenant_id: 'tenant-test',
    conversation_id: 'conv-1',
    recipient_to: '+919876543210',
    text: 'Hello Test',
    status: 'QUEUED',
    created_at: '2026-10-16T08:00:00.000Z',
    updated_at: '2026-10-16T08:00:00.000Z',
    queued_at: '2026-10-16T08:00:00.000Z',
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failed_at: null,
    failure_reason: null,
    version: 1,
  };

  it('progresses forward: QUEUED -> SENT', () => {
    const decision = evaluateStatusTransition(baseMessage, 'SENT', '2026-10-16T08:05:00.000Z');
    assert.equal(decision.shouldUpdateStatus, true);
    assert.equal(decision.targetStatus, 'SENT');
    assert.equal(decision.outcome, 'APPLIED');
    assert.equal(decision.timestampUpdates.sent_at, '2026-10-16T08:05:00.000Z');
  });

  it('progresses forward: SENT -> DELIVERED', () => {
    const sentMessage: MessageRecord = {
      ...baseMessage,
      status: 'SENT',
      sent_at: '2026-10-16T08:05:00.000Z',
    };
    const decision = evaluateStatusTransition(sentMessage, 'DELIVERED', '2026-10-16T08:10:00.000Z');
    assert.equal(decision.shouldUpdateStatus, true);
    assert.equal(decision.targetStatus, 'DELIVERED');
    assert.equal(decision.outcome, 'APPLIED');
    assert.equal(decision.timestampUpdates.delivered_at, '2026-10-16T08:10:00.000Z');
  });

  it('progresses forward: DELIVERED -> READ', () => {
    const deliveredMessage: MessageRecord = {
      ...baseMessage,
      status: 'DELIVERED',
      sent_at: '2026-10-16T08:05:00.000Z',
      delivered_at: '2026-10-16T08:10:00.000Z',
    };
    const decision = evaluateStatusTransition(deliveredMessage, 'READ', '2026-10-16T08:15:00.000Z');
    assert.equal(decision.shouldUpdateStatus, true);
    assert.equal(decision.targetStatus, 'READ');
    assert.equal(decision.outcome, 'APPLIED');
    assert.equal(decision.timestampUpdates.read_at, '2026-10-16T08:15:00.000Z');
  });

  it('prevents backward movement when SENT arrives after READ (out-of-order)', () => {
    const readMessage: MessageRecord = {
      ...baseMessage,
      status: 'READ',
      read_at: '2026-10-16T08:15:00.000Z',
      sent_at: null, // sent_at was missed due to out-of-order arrival
    };

    const decision = evaluateStatusTransition(readMessage, 'SENT', '2026-10-16T08:05:00.000Z');
    // Status must NOT regress
    assert.equal(decision.shouldUpdateStatus, false);
    assert.equal(decision.targetStatus, 'READ');
    assert.equal(decision.outcome, 'IGNORED_OUT_OF_ORDER');
    // BUT missing sent_at timestamp MUST be recorded!
    assert.equal(decision.timestampUpdates.sent_at, '2026-10-16T08:05:00.000Z');
  });

  it('ignores duplicate status transition without altering status', () => {
    const deliveredMessage: MessageRecord = {
      ...baseMessage,
      status: 'DELIVERED',
      delivered_at: '2026-10-16T08:10:00.000Z',
    };

    const decision = evaluateStatusTransition(deliveredMessage, 'DELIVERED', '2026-10-16T08:10:00.000Z');
    assert.equal(decision.shouldUpdateStatus, false);
    assert.equal(decision.targetStatus, 'DELIVERED');
    assert.equal(decision.outcome, 'IGNORED_OUT_OF_ORDER');
  });

  it('transitions to FAILED from QUEUED', () => {
    const decision = evaluateStatusTransition(baseMessage, 'FAILED', '2026-10-16T08:02:00.000Z');
    assert.equal(decision.shouldUpdateStatus, true);
    assert.equal(decision.targetStatus, 'FAILED');
    assert.equal(decision.outcome, 'APPLIED');
    assert.equal(decision.timestampUpdates.failed_at, '2026-10-16T08:02:00.000Z');
  });

  it('cannot resurrect from terminal FAILED state to SENT or DELIVERED', () => {
    const failedMessage: MessageRecord = {
      ...baseMessage,
      status: 'FAILED',
      failed_at: '2026-10-16T08:02:00.000Z',
    };

    const decision = evaluateStatusTransition(failedMessage, 'SENT', '2026-10-16T08:05:00.000Z');
    assert.equal(decision.shouldUpdateStatus, false);
    assert.equal(decision.targetStatus, 'FAILED');
    assert.equal(decision.outcome, 'IGNORED_TERMINAL');
  });

  it('does not transition to FAILED if message was already DELIVERED', () => {
    const deliveredMessage: MessageRecord = {
      ...baseMessage,
      status: 'DELIVERED',
      delivered_at: '2026-10-16T08:10:00.000Z',
    };

    const decision = evaluateStatusTransition(deliveredMessage, 'FAILED', '2026-10-16T08:12:00.000Z');
    assert.equal(decision.shouldUpdateStatus, false);
    assert.equal(decision.targetStatus, 'DELIVERED');
    assert.equal(decision.outcome, 'IGNORED_OUT_OF_ORDER');
  });
});
