import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../errors/AppError.js';

/**
 * Extracts optional x-tenant-id header into req.tenantId.
 */
export function extractTenantId(req: Request, _res: Response, next: NextFunction): void {
  const tenantId = req.header('x-tenant-id');
  if (tenantId) {
    req.tenantId = tenantId.trim();
  }
  next();
}

/**
 * Enforces that x-tenant-id is present in the request header.
 * Used for tenant-scoped endpoints like conversation history retrieval.
 */
export function requireTenantHeader(req: Request, _res: Response, next: NextFunction): void {
  const tenantId = req.header('x-tenant-id');
  if (!tenantId || tenantId.trim().length === 0) {
    throw new UnauthorizedError(
      'Missing required x-tenant-id header. For multi-tenant isolation, requests to this endpoint must specify the tenant identifier.'
    );
  }
  req.tenantId = tenantId.trim();
  next();
}
