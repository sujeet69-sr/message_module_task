import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../../src/app.js';
import { createTestDatabase, TestDbContext } from '../helpers/testDb.js';

describe('Concurrency and Simultaneous Status Updates Integration Tests', () => {
  let testDb: TestDbContext;

  before(() => {
    testDb = createTestDatabase();
  });

  after(() => {
    testDb.cleanup();
  });

  it('Handles simultaneous concurrent webhook events safely without data corruption', async () => {
    // 1. Create message
    const createRes = await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-concurrent',
        conversationId: 'conv-concurrent',
        to: '+919876543210',
        text: 'Stress testing concurrent webhooks',
      })
      .expect(201);

    const messageId = createRes.body.data.id;

    // 2. Dispatch 10 concurrent webhook calls with distinct eventIds
    const statuses = ['SENT', 'DELIVERED', 'READ'];
    const promises = [];

    for (let i = 0; i < 10; i++) {
      const status = statuses[i % statuses.length];
      const eventId = `evt-concurrent-${i}`;
      const occurredAt = new Date(Date.now() + i * 1000).toISOString();

      promises.push(
        request(app)
          .post('/api/v1/webhooks/provider')
          .send({
            eventId,
            messageId,
            status,
            occurredAt,
          })
      );
    }

    const responses = await Promise.all(promises);

    // Verify all 10 concurrent requests received HTTP 200 OK
    for (const res of responses) {
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    }

    // Verify all 10 events were persisted in database
    const eventCount = testDb.db
      .prepare('SELECT COUNT(*) as count FROM webhook_events WHERE message_id = ?')
      .get(messageId) as { count: number };

    assert.equal(Number(eventCount.count), 10);

    // Verify message has valid status (DELIVERED or READ) and hasn't regressed
    const msgRes = await request(app).get(`/api/v1/messages/${messageId}`).expect(200);
    assert.ok(['DELIVERED', 'READ'].includes(msgRes.body.data.status));
  });
});
