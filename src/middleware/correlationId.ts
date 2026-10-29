import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      tenantId?: string;
    }
  }
}

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.header('x-request-id') || req.header('x-correlation-id') || `req_${crypto.randomUUID()}`) as string;
  req.correlationId = correlationId;
  res.setHeader('x-request-id', correlationId);
  next();
}
