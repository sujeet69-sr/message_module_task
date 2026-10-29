import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../../src/app.js';
import { createTestDatabase, TestDbContext } from '../helpers/testDb.js';

describe('Health and Metrics API Integration Tests', () => {
  let testDb: TestDbContext;

  before(() => {
    testDb = createTestDatabase();
  });

  after(() => {
    testDb.cleanup();
  });

  it('GET /health returns 200 with service health and database connection status', async () => {
    const res = await request(app).get('/health').expect(200);

    assert.equal(res.body.status, 'healthy');
    assert.equal(res.body.database.status, 'connected');
    assert.equal(res.body.database.engine, 'sqlite');
    assert.ok(typeof res.body.uptime === 'number');
    assert.ok(res.body.timestamp);
  });

  it('GET /metrics returns metrics telemetry and queue statistics', async () => {
    const res = await request(app).get('/metrics').expect(200);

    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.data.messagesCreated === 'number');
    assert.ok(typeof res.body.data.webhooksTotal === 'number');
    assert.ok(typeof res.body.data.workerQueue === 'object');
  });
});
