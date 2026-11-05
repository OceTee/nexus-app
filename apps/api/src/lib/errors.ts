// Error hierarchy from TDD Section F, Error handling. The error handler maps
// these to `{ error: { code, message, details, requestId } }`.

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super(400, 'VALIDATION_FAILED', 'Invalid request', details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(code = 'UNAUTHENTICATED') {
    super(401, code, 'Authentication required');
  }
}

export class ForbiddenError extends AppError {
  constructor(code = 'FORBIDDEN') {
    super(403, code, 'Not allowed');
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(404, 'NOT_FOUND', `${entity} not found`);
  }
}

export class DuplicateError extends AppError {
  constructor(entity: string, value: string) {
    super(409, 'DUPLICATE', `${entity} '${value}' already exists`);
  }
}

export class CursorTooOldError extends AppError {
  constructor() {
    super(409, 'CURSOR_TOO_OLD', 'Re-sync from snapshot');
  }
}

export class BusinessRuleError extends AppError {
  constructor(code: string, message: string) {
    super(422, code, message);
  }
}

export class RateLimitedError extends AppError {
  constructor(public readonly retryAfter: number) {
    super(429, 'RATE_LIMITED', 'Too many requests');
  }
}
