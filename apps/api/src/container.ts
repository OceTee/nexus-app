// Composition root: builds services from configuration and infrastructure.
// index.ts uses real integrations; tests pass in-memory queue and senders.

import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import type { Db } from './db/client';
import { createLimiters, type LimiterStore, type Limiters } from './http/middleware/rateLimit';
import { LogSender, ResendSender, type EmailSender } from './integrations/email';
import { ExpoPushSender, type PushSender } from './integrations/push';
import { createJobHandlers } from './jobs/handlers';
import type { JobHandlers, JobQueue } from './jobs/queue';
import { createAccessTokenSigner, type AccessTokenSigner } from './lib/tokens';
import { AccountService } from './modules/account/account.service';
import { AuditService } from './modules/audit/audit.service';
import { AuthRepo } from './modules/auth/auth.repo';
import { AuthService } from './modules/auth/auth.service';
import { DevicesService } from './modules/devices/devices.service';

export interface ContainerDeps {
  env: Env;
  logger: Logger;
  db: Db;
  pool: pg.Pool;
  queue: JobQueue;
  email?: EmailSender;
  push?: PushSender;
  limiterStore?: LimiterStore;
}

export interface Container {
  db: Db;
  signer: AccessTokenSigner;
  limiters: Limiters;
  queue: JobQueue;
  jobHandlers: JobHandlers;
  auth: AuthService;
  account: AccountService;
  devices: DevicesService;
}

export function createContainer(deps: ContainerDeps): Container {
  const { env, logger, db, pool, queue } = deps;

  let secret = env.JWT_SECRET;
  if (!secret) {
    logger.warn('JWT_SECRET is not set; using a random secret (tokens die on restart)');
    secret = randomBytes(32).toString('base64url');
  }
  const signer = createAccessTokenSigner(
    { kid: env.JWT_KID, secret },
    env.JWT_SECRET_PREVIOUS && env.JWT_KID_PREVIOUS
      ? { kid: env.JWT_KID_PREVIOUS, secret: env.JWT_SECRET_PREVIOUS }
      : undefined,
  );

  const limiters = createLimiters(deps.limiterStore ?? { kind: env.RATE_LIMIT_STORE, pool });
  const email =
    deps.email ??
    (env.RESEND_API_KEY
      ? new ResendSender(env.RESEND_API_KEY, env.MAIL_FROM)
      : new LogSender(logger));
  const push = deps.push ?? new ExpoPushSender(env.EXPO_ACCESS_TOKEN, logger);

  const audit = new AuditService();
  const authRepo = new AuthRepo();

  return {
    db,
    signer,
    limiters,
    queue,
    jobHandlers: createJobHandlers({ db, logger, email, push, limiters }),
    auth: new AuthService({
      db,
      repo: authRepo,
      audit,
      signer,
      queue,
      limiters,
      appUrl: env.APP_URL,
    }),
    account: new AccountService(db, audit, queue),
    devices: new DevicesService(db, authRepo, audit),
  };
}
