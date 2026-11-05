import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, LockedError, NotFoundError, RateLimitedError } from '../../lib/errors';

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route'));
};

function isBodyParseError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed'
  );
}

/** Serialises AppError; anything else becomes a generic 500 with no stack trace. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err instanceof RateLimitedError || err instanceof LockedError)
      res.setHeader('Retry-After', String(err.retryAfter));
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
    });
    return;
  }
  if (isBodyParseError(err)) {
    res.status(400).json({
      error: { code: 'MALFORMED_JSON', message: 'Malformed JSON body', requestId: req.id },
    });
    return;
  }
  req.log.error({ err }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id },
  });
};
