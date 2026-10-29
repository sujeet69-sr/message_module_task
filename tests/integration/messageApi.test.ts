import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../../src/app.js';
import { createTestDatabase, TestDbContext } from '../helpers/testDb.js';

describe('Message API Integration Tests', () => {
  let testDb: TestDbContext;

  before(() => {
    testDb = createTestDatabase();
  });

  after(() => {
    testDb.cleanup();
  });

  it('POST /api/v1/messages successfully creates a message with status QUEUED', async () => {
    const payload = {
      tenantId: 'tenant-a',
      conversationId: 'conv-100',
      to: '+919876543210',
      text: 'Your Order has shipped',
    };

    const res = await request(app)
      .post('/api/v1/messages')
      .send(payload)
      .expect(201);

    assert.equal(res.body.success, true);
    assert.ok(res.body.data.id.startsWith('msg-'));
    assert.equal(res.body.data.tenantId, 'tenant-a');
    assert.equal(res.body.data.conversationId, 'conv-100');
    assert.equal(res.body.data.to, '+919876543210');
    assert.equal(res.body.data.text, 'Your Order has shipped');
    assert.equal(res.body.data.status, 'QUEUED');
    assert.ok(res.body.data.timestamps.queuedAt);
    assert.equal(res.body.data.timestamps.sentAt, null);
    assert.equal(res.body.data.timestamps.deliveredAt, null);
    assert.equal(res.body.data.timestamps.readAt, null);
  });

  it('GET /api/v1/messages/:messageId retrieves the created message', async () => {
    const createRes = await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-b',
        conversationId: 'conv-200',
        to: '+14155552671',
        text: 'Appointment reminder for tomorrow',
      })
      .expect(201);

    const messageId = createRes.body.data.id;

    const getRes = await request(app)
      .get(`/api/v1/messages/${messageId}`)
      .expect(200);

    assert.equal(getRes.body.success, true);
    assert.equal(getRes.body.data.id, messageId);
    assert.equal(getRes.body.data.tenantId, 'tenant-b');
    assert.equal(getRes.body.data.status, 'QUEUED');
  });

  it('Enforces tenant isolation on GET /api/v1/messages/:messageId', async () => {
    const createRes = await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-x',
        conversationId: 'conv-x',
        to: '+919876543210',
        text: 'Confidential tenant X message',
      })
      .expect(201);

    const messageId = createRes.body.data.id;

    // Tenant X can read it
    await request(app)
      .get(`/api/v1/messages/${messageId}`)
      .set('x-tenant-id', 'tenant-x')
      .expect(200);

    // Tenant Y attempting to read Tenant X message receives 404 (doesn't leak existence)
    const forbiddenRes = await request(app)
      .get(`/api/v1/messages/${messageId}`)
      .set('x-tenant-id', 'tenant-y')
      .expect(404);

    assert.equal(forbiddenRes.body.error, 'NOT_FOUND');
  });

  it('Rejects invalid payload with 400 Bad Request and validation details', async () => {
    const invalidPayload = {
      tenantId: '',
      conversationId: '',
      to: 'invalid-phone-string',
      text: '',
    };

    const res = await request(app)
      .post('/api/v1/messages')
      .send(invalidPayload)
      .expect(400);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.body.details));
    assert.ok(res.body.details.length >= 3);
  });

  it('Rejects malformed JSON with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/v1/messages')
      .set('Content-Type', 'application/json')
      .send('{ "tenantId": "tenant-a", broken JSON }')
      .expect(400);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });
});
