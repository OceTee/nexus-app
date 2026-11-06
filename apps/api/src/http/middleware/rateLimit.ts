import type { Request, RequestHandler, Response } from 'express';
import type pg from 'pg';
import {
  RateLimiterMemory,
  RateLimiterPostgres,
  RateLimiterRes,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible';
import { RATE_LIMITS } from '../../config/constants';
import { RateLimitedError } from '../../lib/errors';

export type LimiterName = keyof typeof RATE_LIMITS;
export type Limiters = Record<LimiterName, RateLimiterAbstract>;

export interface LimiterStore {
  kind: 'postgres' | 'memory';
  /** Pool for the Postgres store (table `rate_limits`, created by migration 0002). */
  pool?: pg.Pool;
  /** Namespaces keys, e.g. per test. */
  prefix?: string;
}

/** Builds every limiter from TDD Section F on one store. */
/**
 * Builds every limiter. `relaxAuth` (E2E_MODE only) multiplies the auth burst
 * allowance so an end-to-end suite can create and sign in many accounts.
 */
export function createLimiters(store: LimiterStore, relaxAuth = false): Limiters {
  const make = (name: LimiterName): RateLimiterAbstract => {
    const { duration } = RATE_LIMITS[name];
    const points = RATE_LIMITS[name].points * (relaxAuth && name === 'authBurst' ? 100 : 1);
    const keyPrefix = `${store.prefix ?? 'rl'}:${name}`;
    if (store.kind === 'postgres') {
      if (!store.pool) throw new Error('Postgres rate-limit store needs a pool');
      return new RateLimiterPostgres({
        storeClient: store.pool,
        storeType: 'pool',
        tableName: 'rate_limits',
        tableCreated: true,
        keyPrefix,
        points,
        duration,
      });
    }
    return new RateLimiterMemory({ keyPrefix, points, duration });
  };
  return Object.fromEntries(
    (Object.keys(RATE_LIMITS) as LimiterName[]).map((n) => [n, make(n)]),
  ) as Limiters;
}

function setHeaders(res: Response, limiter: RateLimiterAbstract, r: RateLimiterRes): void {
  res.setHeader('RateLimit-Limit', String(limiter.points));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, r.remainingPoints)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(r.msBeforeNext / 1000)));
}

/** Consumes one point for `key`; throws 429 RATE_LIMITED with `Retry-After` when exhausted. */
export async function consume(
  limiter: RateLimiterAbstract,
  key: string,
  res?: Response,
): Promise<void> {
  try {
    const r = await limiter.consume(key);
    if (res) setHeaders(res, limiter, r);
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      if (res) setHeaders(res, limiter, err);
      throw new RateLimitedError(Math.max(1, Math.ceil(err.msBeforeNext / 1000)));
    }
    throw err;
  }
}

/** Middleware form: `rateLimit(limiters.authBurst, (req) => req.ip)`. */
export function rateLimit(
  limiter: RateLimiterAbstract,
  key: (req: Request) => string | undefined,
): RequestHandler {
  return async (req, res, next) => {
    await consume(limiter, key(req) ?? 'unknown', res);
    next();
  };
}

/** Client IP (Express resolves it through the trusted proxy). */
export const byIp = (req: Request): string => `ip:${req.ip ?? 'unknown'}`;

/** Authenticated user, or IP when anonymous. */
export const byUserOrIp = (req: Request): string =>
  req.auth?.userId ? `user:${req.auth.userId}` : byIp(req);
