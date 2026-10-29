import { EventOutcome } from '../models/types.js';
import { jobQueueRepository } from '../repositories/jobQueueRepository.js';

export interface MetricsSummary {
  uptimeSeconds: number;
  messagesCreated: number;
  webhooksTotal: number;
  webhooksDuplicatesIgnored: number;
  webhooksOutOfOrderHandled: number;
  webhooksUnmatched: number;
  webhooksApplied: number;
  workerQueue: Record<string, number>;
}

class MetricsService {
  private startTime = Date.now();
  private messagesCreatedCount = 0;
  private webhooksTotalCount = 0;
  private webhooksDuplicatesCount = 0;
  private webhooksOutOfOrderCount = 0;
  private webhooksUnmatchedCount = 0;
  private webhooksAppliedCount = 0;

  public recordMessageCreated(): void {
    this.messagesCreatedCount++;
  }

  public recordDuplicateWebhook(): void {
    this.webhooksTotalCount++;
    this.webhooksDuplicatesCount++;
  }

  public recordUnmatchedWebhook(): void {
    this.webhooksTotalCount++;
    this.webhooksUnmatchedCount++;
  }

  public recordWebhookProcessed(outcome: EventOutcome): void {
    this.webhooksTotalCount++;
    if (outcome === 'APPLIED') {
      this.webhooksAppliedCount++;
    } else if (outcome === 'IGNORED_OUT_OF_ORDER') {
      this.webhooksOutOfOrderCount++;
    }
  }

  public async getMetrics(): Promise<MetricsSummary> {
    let queueStats: Record<string, number> = {};
    try {
      queueStats = await jobQueueRepository.getStats();
    } catch {
      queueStats = { error: -1 };
    }

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      messagesCreated: this.messagesCreatedCount,
      webhooksTotal: this.webhooksTotalCount,
      webhooksDuplicatesIgnored: this.webhooksDuplicatesCount,
      webhooksOutOfOrderHandled: this.webhooksOutOfOrderCount,
      webhooksUnmatched: this.webhooksUnmatchedCount,
      webhooksApplied: this.webhooksAppliedCount,
      workerQueue: queueStats,
    };
  }

  public reset(): void {
    this.startTime = Date.now();
    this.messagesCreatedCount = 0;
    this.webhooksTotalCount = 0;
    this.webhooksDuplicatesCount = 0;
    this.webhooksOutOfOrderCount = 0;
    this.webhooksUnmatchedCount = 0;
    this.webhooksAppliedCount = 0;
  }
}

export const metricsService = new MetricsService();
