import cors from 'cors';
import helmet from 'helmet';
import type { RequestHandler } from 'express';

/** helmet for security headers (no CSP for a JSON API) and an origin allow-list for CORS. */
export function security(allowedOrigins: readonly string[]): RequestHandler[] {
  return [
    helmet({ contentSecurityPolicy: false }),
    cors({
      // Native apps send no Origin header; browsers must be on the allow-list.
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
    }),
  ];
}
