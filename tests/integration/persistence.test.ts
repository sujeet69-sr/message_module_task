import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { runMigrations } from '../../migrations/migrate.js';
import { closeDatabase, getDatabase } from '../../src/db/database.js';
import { messageRepository } from '../../src/repositories/messageRepository.js';
import { webhookService } from '../../src/services/webhookService.js';

describe('Server Restart & Database Persistence Tests', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-persist-test-'));
  const persistentDbPath = path.join(tempDir, 'persistence_verify.db');

  after(() => {
    closeDatabase();
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('Verifies message and webhook event persist across server restarts', () => {
    // Phase 1: Initialize server session 1
    process.env.DATABASE_PATH = persistentDbPath;
    let db: DatabaseSync = getDatabase(persistentDbPath);
    runMigrations(db);

    const messageId = 'msg-persist-123';
    const now = new Date().toISOString();

    // Persist a message
    messageRepository.create(
      {
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
      },
      db
    );

    // Apply webhook update
    webhookService.processWebhookEvent(
      {
        eventId: 'evt-persist-1',
        messageId,
        status: 'DELIVERED',
        occurredAt: '2026-10-16T09:00:00.000Z',
      },
      db
    );

    // Phase 2: Simulate process crash / server restart by closing the DB connection
    closeDatabase();

    // Verify the physical database file exists on disk and is non-empty
    assert.ok(fs.existsSync(persistentDbPath));
    const stats = fs.statSync(persistentDbPath);
    assert.ok(stats.size > 0, 'Database file on disk should not be empty');

    // Phase 3: Start server session 2 on the exact same database file
    db = getDatabase(persistentDbPath);

    // Query message from restarted database
    const restoredMessage = messageRepository.findById(messageId, db);
    assert.ok(restoredMessage, 'Message should be found in database after restart');
    assert.equal(restoredMessage.id, messageId);
    assert.equal(restoredMessage.status, 'DELIVERED');
    assert.equal(restoredMessage.delivered_at, '2026-10-16T09:00:00.000Z');
    assert.equal(restoredMessage.text, 'This message must survive restarts');
  });
});
