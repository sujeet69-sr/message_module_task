import { getEnvConfig } from '../config/env.js';
import { WorkerJobRecord } from '../models/types.js';
import { jobQueueRepository } from '../repositories/jobQueueRepository.js';
import { logger } from '../utils/logger.js';

export type JobHandler = (payload: any, job: WorkerJobRecord) => Promise<void> | void;

export class WorkerQueueService {
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isRunning = false;

  constructor() {
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    // Default simulated outbound message dispatcher
    this.registerHandler('message-dispatch', async (payload: any, job: WorkerJobRecord) => {
      logger.info('Worker processed outbound message dispatch job', {
        jobId: job.id,
        messageId: payload.messageId,
      });
    });
  }

  public registerHandler(queue: string, handler: JobHandler): void {
    this.handlers.set(queue, handler);
  }

  public enqueue(queue: string, payload: unknown, maxAttempts?: number): WorkerJobRecord {
    const config = getEnvConfig();
    const attempts = maxAttempts ?? config.WORKER_MAX_RETRIES;
    const job = jobQueueRepository.enqueue(queue, payload, attempts);
    logger.debug('Job enqueued', { jobId: job.id, queue });
    return job;
  }

  public start(): void {
    const config = getEnvConfig();
    if (!config.WORKER_ENABLED) {
      logger.info('Worker queue disabled via configuration');
      return;
    }

    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('Starting background worker queue', {
      intervalMs: config.WORKER_POLL_INTERVAL_MS,
      concurrency: config.WORKER_CONCURRENCY,
    });

    this.timer = setInterval(() => {
      this.processNextJobs().catch((err) => {
        logger.error('Error during worker job polling loop', { error: err.message });
      });
    }, config.WORKER_POLL_INTERVAL_MS);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('Worker queue stopped');
  }

  public async processNextJobs(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    let processedCount = 0;
    try {
      const config = getEnvConfig();
      for (const queue of this.handlers.keys()) {
        const jobs = jobQueueRepository.fetchPendingJobs(queue, config.WORKER_CONCURRENCY);

        for (const job of jobs) {
          const acquired = jobQueueRepository.markProcessing(job.id);
          if (!acquired) continue;

          await this.executeJob(job);
          processedCount++;
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  private async executeJob(job: WorkerJobRecord): Promise<void> {
    const handler = this.handlers.get(job.queue);
    const config = getEnvConfig();

    if (!handler) {
      logger.error('No handler registered for queue', { queue: job.queue, jobId: job.id });
      jobQueueRepository.markFailed(
        job.id,
        `No handler registered for queue ${job.queue}`,
        new Date().toISOString(),
        true
      );
      return;
    }

    try {
      const parsedPayload = JSON.parse(job.payload);
      await handler(parsedPayload, job);
      jobQueueRepository.markCompleted(job.id);
      logger.debug('Job executed successfully', { jobId: job.id, queue: job.queue });
    } catch (error: any) {
      const currentAttempt = job.attempts + 1;
      const willRetry = currentAttempt < job.max_attempts;

      // Exponential backoff: baseMs * (2 ^ attempt) + jitter
      const jitter = Math.floor(Math.random() * 200);
      const delayMs = config.WORKER_BACKOFF_BASE_MS * Math.pow(2, currentAttempt) + jitter;
      const nextRunAt = new Date(Date.now() + delayMs).toISOString();

      logger.warn('Job failed during execution', {
        jobId: job.id,
        attempt: currentAttempt,
        maxAttempts: job.max_attempts,
        willRetry,
        nextRunAt: willRetry ? nextRunAt : undefined,
        error: error.message,
      });

      jobQueueRepository.markFailed(
        job.id,
        error.message || 'Execution error',
        nextRunAt,
        !willRetry
      );
    }
  }
}

export const workerQueueService = new WorkerQueueService();
