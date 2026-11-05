import { pino, type Logger } from 'pino';
import type { Env } from '../config/env';

/** Paths that must never reach the logs (TDD Section F, Logging). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.refreshToken',
  '*.bodyMd',
  '*.title',
  '*.email',
];

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  const level = env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug');
  return pino({ level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } });
}
