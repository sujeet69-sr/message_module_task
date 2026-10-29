import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../../src/app.js';
import { createTestDatabase, TestDbContext } from '../helpers/testDb.js';

describe('Webhook Provider API Integration Tests', () => {
  let testDb: TestDbContext;

  before(() => {
    testDb = createTestDatabase();
  });

  after(() => {
    testDb.cleanup();
  });

  it('Successfully processes normal status progression: QUEUED -> SENT -> DELIVERED -> READ', async () => {
    // 1. Create message
    const createRes = await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-a',
        conversationId: 'conv-progression',
        to: '+919876543210',
        text: 'Order dispatched',
      })
      .expect(201);

    const messageId = createRes.body.data.id;

    // 2. SENT webhook
    const sentRes = await request(app)
      .post('/api/v1/webhooks/provider')
      .send({
        eventId: 'evt-prog-1',
        messageId,
        status: 'SENT',
        occurredAt: '2026-10-16T08:30:00.000Z',
      })
      .expect(200);

    assert.equal(sentRes.body.data.outcome, 'APPLIED');
    assert.equal(sentRes.body.data.messageStatus, 'SENT');

    // 3. DELIVERED webhook
    const deliveredRes = await request(app)
      .post('/api/v1/webhooks/provider')
      .send({
        eventId: 'evt-prog-2',
        messageId,
        status: 'DELIVERED',
        occurredAt: '2026-10-16T08:31:00.000Z',
      })
      .expect(200);

    assert.equal(deliveredRes.body.data.outcome, 'APPLIED');
    assert.equal(deliveredRes.body.data.messageStatus, 'DELIVERED');

    // 4. READ webhook
    const readRes = await request(app)
      .post('/api/v1/webhooks/provider')
      .send({
        eventId: 'evt-prog-3',
        messageId,
        status: 'READ',
        occurredAt: '2026-10-16T08:35:00.000Z',
      })
      .expect(200);

    assert.equal(readRes.body.data.outcome, 'APPLIED');
    assert.equal(readRes.body.data.messageStatus, 'READ');

    // 5. Verify final message state
    const msgRes = await request(app).get(`/api/v1/messages/${messageId}`).expect(200);
    assert.equal(msgRes.body.data.status, 'READ');
    assert.equal(msgRes.body.data.timestamps.sentAt, '2026-10-16T08:30:00.000Z');
    assert.equal(msgRes.body.data.timestamps.deliveredAt, '2026-10-16T08:31:00.000Z');
    assert.equal(msgRes.body.data.timestamps.readAt, '2026-10-16T08:35:00.000Z');
    assert.equal(msgRes.body.data.history.length, 3);
  });

  it('Enforces idempotency: repeated eventId is ignored and does not create duplicate effects', async () => {
    // 1. Create message
    const createRes = await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-a',
        conversationId: 'conv-idempotency',
        to: '+919876543210',
        text: 'Testing idempotency',
      })
      .expect(201);

    const messageId = createRes.body.data.id;
    const eventPayload = {
      eventId: 'evt-idem-unique-1',
      messageId,
      status: 'SENT',
      occurredAt: '2026-10-16T08:30:00.000Z',
    };

    // First call: APPLIED
    const firstCall = await request(app)
      .post('/api/v1/webhooks/provider')
      .send(eventPayload)
      .expect(200);

    assert.equal(firstCall.body.data.duplicate, false);
    assert.equal(firstCall.body.data.outcome, 'APPLIED');

    // Repeated call with identical eventId: IGNORED_DUPLICATE
    const secondCall = await request(app)
      .post('/api/v1/webhooks/provider')
      .send(eventPayload)
      .expect(200);

    assert.equal(secondCall.body.data.duplicate, true);
    assert.equal(secondCall.body.data.outcome, 'IGNORED_DUPLICATE');

    // Third call: also safe
    const thirdCall = await request(app)
      .post('/api/v1/webhooks/provider')
      .send(eventPayload)
      .expect(200);

    assert.equal(thirdCall.body.data.duplicate, true);

    // Verify DB only has 1 event record for evt-idem-unique-1
    const countRow = testDb.db
      .prepare('SELECT COUNT(*) as cnt FROM webhook_events WHERE event_id = ?')
      .get('evt-idem-unique-1') as { cnt: number };

    assert.equal(Number(countRow.cnt), 1);
  });

  it('Handles out-of-order events: prevents backwards status regression while preserving timestamps', async () => {
    // 1. Create message
    const createRes = await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-a',
        conversationId: 'conv-ooo',
        to: '+919876543210',
        text: 'Testing out of order delivery',
      })
      .expect(201);

    const messageId = createRes.body.data.id;

    // 2. READ arrives first (e.g. network delay on SENT)
    const readRes = await request(app)
      .post('/api/v1/webhooks/provider')
      .send({
        eventId: 'evt-ooo-read',
        messageId,
        status: 'READ',
        occurredAt: '2026-10-16T08:40:00.000Z',
      })
      .expect(200);

    assert.equal(readRes.body.data.outcome, 'APPLIED');
    assert.equal(readRes.body.data.messageStatus, 'READ');

    // 3. SENT arrives later
    const sentRes = await request(app)
      .post('/api/v1/webhooks/provider')
      .send({
        eventId: 'evt-ooo-sent',
        messageId,
        status: 'SENT',
        occurredAt: '2026-10-16T08:30:00.000Z',
      })
      .expect(200);

    assert.equal(sentRes.body.data.outcome, 'IGNORED_OUT_OF_ORDER');
    assert.equal(sentRes.body.data.messageStatus, 'READ'); // status did not move backwards!

    // 4. Verify message in DB: status remains READ, but sentAt was backfilled!
    const getRes = await request(app).get(`/api/v1/messages/${messageId}`).expect(200);
    assert.equal(getRes.body.data.status, 'READ');
    assert.equal(getRes.body.data.timestamps.readAt, '2026-10-16T08:40:00.000Z');
    assert.equal(getRes.body.data.timestamps.sentAt, '2026-10-16T08:30:00.000Z');
  });

  it('Returns 404 for unknown message ID and persists unmatched event', async () => {
    const unknownMessageId = 'msg-does-not-exist-999';

    const res = await request(app)
      .post('/api/v1/webhooks/provider')
      .send({
        eventId: 'evt-unknown-msg-1',
        messageId: unknownMessageId,
        status: 'DELIVERED',
        occurredAt: '2026-10-16T08:30:00.000Z',
      })
      .expect(404);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'NOT_FOUND');
    assert.ok(res.body.message.includes(unknownMessageId));

    // Verify unmatched event is recorded in DB for audit trail
    const savedEvent = testDb.db
      .prepare('SELECT * FROM webhook_events WHERE event_id = ?')
      .get('evt-unknown-msg-1') as any;

    assert.ok(savedEvent);
    assert.equal(savedEvent.outcome, 'UNMATCHED_MESSAGE');
  });

  it('Rejects invalid webhook payload with 400 Bad Request', async () => {
    // Missing eventId and invalid status enum
    const res = await request(app)
      .post('/api/v1/webhooks/provider')
      .send({
        messageId: 'msg-123',
        status: 'INVALID_STATUS',
        occurredAt: 'not-a-date',
      })
      .expect(400);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.body.details));
  });
});
