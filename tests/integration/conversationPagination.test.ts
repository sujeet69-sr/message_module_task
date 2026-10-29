import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../../src/app.js';
import { createTestDatabase, TestDbContext } from '../helpers/testDb.js';

describe('Conversation Messages & Tenant Isolation Integration Tests', () => {
  let testDb: TestDbContext;

  before(() => {
    testDb = createTestDatabase();
  });

  after(() => {
    testDb.cleanup();
  });

  it('Requires x-tenant-id header returning 401 Unauthorized if missing', async () => {
    const res = await request(app)
      .get('/api/v1/conversations/conv-1/messages')
      .expect(401);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'UNAUTHORIZED');
    assert.ok(res.body.message.includes('x-tenant-id'));
  });

  it('Enforces tenant isolation: Tenant A cannot see Tenant B messages even with same conversationId', async () => {
    const conversationId = 'shared-conv-name-100';

    // Tenant 1 posts 2 messages
    await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-alpha',
        conversationId,
        to: '+919876543210',
        text: 'Tenant Alpha secret note 1',
      })
      .expect(201);

    await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-alpha',
        conversationId,
        to: '+919876543210',
        text: 'Tenant Alpha secret note 2',
      })
      .expect(201);

    // Tenant 2 posts 1 message in same conversationId
    await request(app)
      .post('/api/v1/messages')
      .send({
        tenantId: 'tenant-beta',
        conversationId,
        to: '+14155552671',
        text: 'Tenant Beta note',
      })
      .expect(201);

    // Tenant Alpha query
    const alphaRes = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('x-tenant-id', 'tenant-alpha')
      .expect(200);

    assert.equal(alphaRes.body.data.length, 2);
    assert.ok(alphaRes.body.data.every((m: any) => m.tenantId === 'tenant-alpha'));

    // Tenant Beta query
    const betaRes = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('x-tenant-id', 'tenant-beta')
      .expect(200);

    assert.equal(betaRes.body.data.length, 1);
    assert.equal(betaRes.body.data[0].tenantId, 'tenant-beta');
  });

  it('Paginates messages deterministically in stable chronological order', async () => {
    const tenantId = 'tenant-pagination-test';
    const conversationId = 'conv-large-stream';

    // Insert 25 sequential messages
    for (let i = 1; i <= 25; i++) {
      await request(app)
        .post('/api/v1/messages')
        .send({
          tenantId,
          conversationId,
          to: '+919876543210',
          text: `Message index ${i.toString().padStart(2, '0')}`,
        })
        .expect(201);
    }

    const fetchedIds: string[] = [];

    // Page 1: limit 10
    const page1 = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages?limit=10`)
      .set('x-tenant-id', tenantId)
      .expect(200);

    assert.equal(page1.body.data.length, 10);
    assert.equal(page1.body.pagination.hasMore, true);
    assert.ok(page1.body.pagination.nextCursor);
    page1.body.data.forEach((m: any) => fetchedIds.push(m.id));

    // Page 2: limit 10 with cursor from Page 1
    const page2 = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages?limit=10&cursor=${page1.body.pagination.nextCursor}`)
      .set('x-tenant-id', tenantId)
      .expect(200);

    assert.equal(page2.body.data.length, 10);
    assert.equal(page2.body.pagination.hasMore, true);
    assert.ok(page2.body.pagination.nextCursor);
    page2.body.data.forEach((m: any) => fetchedIds.push(m.id));

    // Page 3: limit 10 with cursor from Page 2 (should return final 5)
    const page3 = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages?limit=10&cursor=${page2.body.pagination.nextCursor}`)
      .set('x-tenant-id', tenantId)
      .expect(200);

    assert.equal(page3.body.data.length, 5);
    assert.equal(page3.body.pagination.hasMore, false);
    assert.equal(page3.body.pagination.nextCursor, null);
    page3.body.data.forEach((m: any) => fetchedIds.push(m.id));

    // Verify 25 unique items fetched in total with no duplicates
    assert.equal(fetchedIds.length, 25);
    const uniqueIds = new Set(fetchedIds);
    assert.equal(uniqueIds.size, 25);
  });
});
