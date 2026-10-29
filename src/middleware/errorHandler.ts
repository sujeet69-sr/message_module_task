import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = req.correlationId;

  // 1. Handle JSON syntax errors from body-parser
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
    logger.warn('Malformed JSON in request body', {
      correlationId,
      error: err.message,
    });

    res.status(400).json({
      success: false,
      error: 'BAD_REQUEST',
      message: 'Malformed JSON payload in request body',
    });
    return;
  }

  // 2. Handle Zod validation errors
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    logger.warn('Validation failed for request', {
      correlationId,
      path: req.originalUrl,
      validationErrors: formattedErrors,
    });

    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: formattedErrors,
    });
    return;
  }

  // 3. Handle domain AppError
  if (err instanceof AppError) {
    logger.warn(`Application error [${err.code}]: ${err.message}`, {
      correlationId,
      statusCode: err.statusCode,
      code: err.code,
      details: err.details,
    });

    res.status(err.statusCode).json({
      success: false,
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // 4. Handle unexpected internal server errors
  logger.error('Unhandled internal server error', {
    correlationId,
    message: err?.message || 'Unknown error',
    stack: err?.stack,
  });

  res.status(500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred while processing the request',
    correlationId,
  });
}
