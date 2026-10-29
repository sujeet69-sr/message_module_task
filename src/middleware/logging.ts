import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const correlationId = req.correlationId;
  const tenantId = req.header('x-tenant-id');

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    // Redact query parameters that might contain sensitive data if any
    const query = { ...req.query };

    logger.info(`HTTP ${req.method} ${req.originalUrl || req.url}`, {
      correlationId,
      tenantId,
      method: req.method,
      path: req.baseUrl + req.path,
      statusCode,
      durationMs: duration,
      ip: req.ip,
      query,
    });
  });

  next();
}
