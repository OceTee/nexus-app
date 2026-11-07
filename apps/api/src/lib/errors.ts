// Error hierarchy from TDD Section F, Error handling. The error handler maps
// these to `{ error: { code, message, details, requestId } }`.

/**
 * Postgres refuses some text that JSON and Zod accept, such as the NUL
 * character (22021) or `\u0000` inside jsonb (22P05). Found by the ZAP scan.
 */
export function isUnstorableText(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  return code === '22021' || code === '22P05';
}

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

/** 401 with the same message for unknown email and wrong password (no enumeration). */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
}

/** 423 after too many failed logins for one account. */
export class LockedError extends AppError {
  constructor(public readonly retryAfter: number) {
    super(423, 'LOCKED', 'Too many failed attempts; try again later');
  }
}

/** 400 for an unknown or already-used emailed token. */
export class TokenInvalidError extends AppError {
  constructor() {
    super(400, 'TOKEN_INVALID', 'This link is not valid');
  }
}

/** 410 for an emailed token past its expiry. */
export class TokenGoneError extends AppError {
  constructor() {
    super(410, 'TOKEN_EXPIRED', 'This link has expired');
  }
}

/** 409 for a stale `baseRev`, with the server revision and the stored conflict version. */
export class ConflictError extends AppError {
  constructor(details: { serverRev: number; conflictVersionId: string }) {
    super(409, 'CONFLICT', 'The item changed on another device', details);
  }
}
