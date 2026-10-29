import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { workerQueueService } from '../../src/services/workerQueue.js';
import { createTestDatabase, TestDbContext } from '../helpers/testDb.js';

describe('Worker Queue with Retry & Dead-Letter Queue (DLQ) Tests', () => {
  let testDb: TestDbContext;

  before(() => {
    testDb = createTestDatabase();
  });

  after(() => {
    workerQueueService.stop();
    testDb.cleanup();
  });

  it('Enqueues, processes, and marks jobs as COMPLETED', async () => {
    let jobExecuted = false;

    workerQueueService.registerHandler('test-success-queue', async (payload: any) => {
      if (payload.value === 42) {
        jobExecuted = true;
      }
    });

    const job = await workerQueueService.enqueue('test-success-queue', { value: 42 });
    assert.ok(job.id);
    assert.equal(job.status, 'PENDING');

    // Run processor
    const processed = await workerQueueService.processNextJobs();
    assert.ok(processed >= 1);
    assert.equal(jobExecuted, true);

    const updatedJob = testDb.db
      .prepare('SELECT * FROM worker_jobs WHERE id = ?')
      .get(job.id) as any;

    assert.equal(updatedJob.status, 'COMPLETED');
  });

  it('Retries failing jobs and routes to DEAD_LETTER after max attempts', async () => {
    let attemptCounter = 0;

    workerQueueService.registerHandler('test-dlq-queue', async () => {
      attemptCounter++;
      throw new Error(`Simulated transient failure on attempt ${attemptCounter}`);
    });

    // Enqueue job with maxAttempts = 2
    const job = await workerQueueService.enqueue('test-dlq-queue', { test: true }, 2);

    // Attempt 1: fails, status moves to FAILED, will retry
    await workerQueueService.processNextJobs();

    let jobInDb = testDb.db
      .prepare('SELECT * FROM worker_jobs WHERE id = ?')
      .get(job.id) as any;

    assert.equal(jobInDb.status, 'FAILED');
    assert.equal(jobInDb.attempts, 1);
    assert.ok(jobInDb.error_message.includes('Simulated transient failure'));

    // Fast-forward next_run_at to simulate backoff elapsing
    testDb.db
      .prepare("UPDATE worker_jobs SET next_run_at = datetime('now', '-1 minute') WHERE id = ?")
      .run(job.id);

    // Attempt 2: reaches max attempts (2), routes to DEAD_LETTER
    await workerQueueService.processNextJobs();

    jobInDb = testDb.db
      .prepare('SELECT * FROM worker_jobs WHERE id = ?')
      .get(job.id) as any;

    assert.equal(jobInDb.status, 'DEAD_LETTER');
    assert.equal(jobInDb.attempts, 2);
  });
});
