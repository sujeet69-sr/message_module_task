export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  public readonly statusCode = 400;
  constructor(message: string, details?: unknown) {
    super(message, 'BAD_REQUEST', details);
  }
}

export class UnauthorizedError extends AppError {
  public readonly statusCode = 401;
  constructor(message: string = 'Authentication required', details?: unknown) {
    super(message, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  public readonly statusCode = 403;
  constructor(message: string = 'Forbidden access to this resource', details?: unknown) {
    super(message, 'FORBIDDEN', details);
  }
}

export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  constructor(message: string = 'Resource not found', details?: unknown) {
    super(message, 'NOT_FOUND', details);
  }
}

export class ConflictError extends AppError {
  public readonly statusCode = 409;
  constructor(message: string = 'Conflict occurred during update', details?: unknown) {
    super(message, 'CONFLICT', details);
  }
}

export class InternalServerError extends AppError {
  public readonly statusCode = 500;
  constructor(message: string = 'Internal server error', details?: unknown) {
    super(message, 'INTERNAL_SERVER_ERROR', details);
  }
}
