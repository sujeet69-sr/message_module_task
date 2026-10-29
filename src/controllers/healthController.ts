import { Request, Response } from 'express';
import { checkDatabaseHealth } from '../db/database.js';
import { metricsService } from '../services/metricsService.js';

export class HealthController {
  public async getHealth(_req: Request, res: Response): Promise<void> {
    const isDbConnected = await checkDatabaseHealth();
    const uptimeSeconds = process.uptime();

    if (!isDbConnected) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: uptimeSeconds,
        database: {
          status: 'disconnected',
        },
      });
      return;
    }

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: uptimeSeconds,
      database: {
        status: 'connected',
        engine: 'postgresql',
      },
      version: '1.0.0',
    });
  }

  public async getMetrics(_req: Request, res: Response): Promise<void> {
    const metrics = await metricsService.getMetrics();
    res.status(200).json({
      success: true,
      data: metrics,
    });
  }
}

export const healthController = new HealthController();
