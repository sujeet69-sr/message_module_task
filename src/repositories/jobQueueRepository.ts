import { DatabaseSync } from 'node:sqlite';
import { getDatabaseAdapter } from '../db/adapter.js';
import { WorkerJobRecord } from '../models/types.js';

export class JobQueueRepository {
  public async enqueue(queue: string, payload: unknown, maxAttempts: number = 3, _db?: DatabaseSync): Promise<WorkerJobRecord> {
    return getDatabaseAdapter().enqueueWorkerJob(queue, payload, maxAttempts);
  }

  public async fetchPendingJobs(queue: string, limit: number = 10, _db?: DatabaseSync): Promise<WorkerJobRecord[]> {
    return getDatabaseAdapter().fetchPendingWorkerJobs(queue, limit);
  }

  public async markProcessing(id: string, _db?: DatabaseSync): Promise<boolean> {
    return getDatabaseAdapter().markWorkerJobProcessing(id);
  }

  public async markCompleted(id: string, _db?: DatabaseSync): Promise<void> {
    return getDatabaseAdapter().markWorkerJobCompleted(id);
  }

  public async markFailed(
    id: string,
    errorMessage: string,
    nextRunAt: string,
    isDeadLetter: boolean,
    _db?: DatabaseSync
  ): Promise<void> {
    return getDatabaseAdapter().markWorkerJobFailed(id, errorMessage, nextRunAt, isDeadLetter);
  }

  public async getStats(_db?: DatabaseSync): Promise<Record<string, number>> {
    return getDatabaseAdapter().getWorkerJobStats();
  }
}

export const jobQueueRepository = new JobQueueRepository();
