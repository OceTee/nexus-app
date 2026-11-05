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
import { CollectionsService } from './modules/collections/collections.service';
import { ContentEngine } from './modules/content/applyOps';
import { GraphService } from './modules/graph/graph.service';
import { LinksService } from './modules/links/links.service';
import { NotesService } from './modules/notes/notes.service';
import { SearchService } from './modules/search/search.service';
import { ChangeFeed } from './modules/sync/changeFeed';
import { SyncService } from './modules/sync/sync.service';
import { TagsService } from './modules/tags/tags.service';

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
  sync: SyncService;
  notes: NotesService;
  collections: CollectionsService;
  tags: TagsService;
  graph: GraphService;
  search: SearchService;
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
  const feed = new ChangeFeed(env.SYNC_VISIBILITY_LAG_MS);
  const links = new LinksService();
  const engine = new ContentEngine(feed, links);

  /** After a batch changes server state, nudge the user's other devices (at most once per 30 s). */
  const nudge = async (userId: string, deviceId: string) => {
    try {
      await limiters.syncNudge.consume(`user:${userId}`);
    } catch {
      return; // debounced
    }
    await queue.send('push.send', {
      userId,
      event: 'sync.nudge',
      excludeDeviceId: deviceId,
      vars: {},
    });
  };

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
    sync: new SyncService(db, engine, feed, queue, nudge),
    notes: new NotesService(db, engine, links),
    collections: new CollectionsService(db, engine),
    tags: new TagsService(db, engine),
    graph: new GraphService(db),
    search: new SearchService(db),
  };
}
