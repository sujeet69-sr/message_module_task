import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { runMigrations } from '../../migrations/migrate.js';
import { closeDatabase, getDatabasePool, resetDatabasePool } from '../../src/db/database.js';
import { messageRepository } from '../../src/repositories/messageRepository.js';
import { webhookService } from '../../src/services/webhookService.js';
import { createTestDatabase } from '../helpers/testDb.js';

describe('Server Restart & PostgreSQL Database Persistence Tests', () => {
  after(async () => {
    await closeDatabase();
    resetDatabasePool();
  });

  it('Verifies message and webhook event persist across server restarts in PostgreSQL', async () => {
    // Phase 1: Initialize server session 1 with test database
    const testDb = await createTestDatabase();
    await runMigrations(testDb.pool);

    const messageId = 'msg-persist-123';
    const now = new Date().toISOString();

    // Persist a message
    await messageRepository.create({
      id: messageId,
      tenant_id: 'tenant-persist',
      conversation_id: 'conv-restart',
      recipient_to: '+919876543210',
      text: 'This message must survive restarts',
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
    });

    // Apply webhook update
    await webhookService.processWebhookEvent({
      eventId: 'evt-persist-1',
      messageId,
      status: 'DELIVERED',
      occurredAt: '2026-10-16T09:00:00.000Z',
    });

    // Phase 2: Simulate process crash / server restart by closing the pool
    await closeDatabase();
    resetDatabasePool();

    // Phase 3: Start server session 2 on the exact same PostgreSQL database
    const newPool = getDatabasePool();

    // Query message from restarted database session
    const restoredMessage = await messageRepository.findById(messageId, newPool);
    assert.ok(restoredMessage, 'Message should be found in PostgreSQL after restart');
    assert.equal(restoredMessage.id, messageId);
    assert.equal(restoredMessage.status, 'DELIVERED');
    assert.equal(restoredMessage.delivered_at, '2026-10-16T09:00:00.000Z');
    assert.equal(restoredMessage.text, 'This message must survive restarts');
  });
});
