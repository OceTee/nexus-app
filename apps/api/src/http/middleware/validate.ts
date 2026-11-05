import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { ValidationError } from '../../lib/errors';

export interface ValidateSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/** Converts Zod issues to the error envelope's `details`: `[{ path, issue, ...params }]`. */
export function issuesToDetails(error: z.ZodError): Record<string, unknown>[] {
  return error.issues.map((issue) => {
    const {
      path,
      code,
      message,
      input: _input,
      ...rest
    } = issue as z.core.$ZodIssue & {
      input?: unknown;
    };
    return { path, issue: code, message, ...rest };
  });
}

/**
 * Parses `params`, `query` and `body` with Zod (unknown keys stripped) and puts
 * the typed values in `req.valid`; the body also replaces `req.body`.
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, _res, next) => {
    req.valid ??= {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) throw new ValidationError(issuesToDetails(result.error));
      req.valid[part] = result.data;
      if (part === 'body') req.body = result.data;
    }
    next();
  };
}

/** Typed accessor for validated input. */
export function input<T>(value: unknown): T {
  return value as T;
}
