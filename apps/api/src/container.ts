// Composition root: builds services from configuration and infrastructure.
// index.ts uses real integrations; tests pass in-memory queue and senders.

import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import type { Db } from './db/client';
import { createLimiters, type LimiterStore, type Limiters } from './http/middleware/rateLimit';
import { BrevoSender, LogSender, ResendSender, type EmailSender } from './integrations/email';
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
import { AttachmentsService } from './modules/attachments/attachments.service';
import { ExportsService } from './modules/exports/exports.service';
import { S3Storage, UnconfiguredStorage, type Storage } from './integrations/r2';

export interface ContainerDeps {
  env: Env;
  logger: Logger;
  db: Db;
  pool: pg.Pool;
  queue: JobQueue;
  email?: EmailSender;
  push?: PushSender;
  limiterStore?: LimiterStore;
  storage?: Storage;
  /** Cross-user connection for maintenance jobs (nexus_maint or owner). */
  maintDb?: Db;
  /** pg_dump runner for backup.dump. */
  dumpDatabase?: () => Promise<Uint8Array>;
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
  attachments: AttachmentsService;
  exports: ExportsService;
  storage: Storage;
  email: EmailSender;
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

  const limiters = createLimiters(
    deps.limiterStore ?? { kind: env.RATE_LIMIT_STORE, pool },
    env.E2E_MODE,
    env.RATE_LIMIT_MULTIPLIER,
  );
  const email =
    deps.email ??
    (env.BREVO_API_KEY
      ? new BrevoSender(env.BREVO_API_KEY, env.MAIL_FROM)
      : env.RESEND_API_KEY
        ? new ResendSender(env.RESEND_API_KEY, env.MAIL_FROM)
        : new LogSender(logger));
  const push = deps.push ?? new ExpoPushSender(env.EXPO_ACCESS_TOKEN, logger);

  const storage = deps.storage ?? storageFromEnv(env, logger);
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

  const container: Container = {
    db,
    signer,
    limiters,
    queue,
    email,
    jobHandlers: undefined as unknown as JobHandlers,
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
    attachments: new AttachmentsService(db, storage, engine, feed),
    exports: new ExportsService(db, storage, queue, env.FEATURE_SERVER_EXPORTS),
    storage,
  };
  if (!deps.maintDb)
    logger.warn('No maintenance connection; scheduled jobs run under RLS and will see no rows');
  container.jobHandlers = createJobHandlers({
    db,
    logger,
    email,
    push,
    limiters,
    exports: container.exports,
    ...(env.DEMO_PASSWORD ? { demoPassword: env.DEMO_PASSWORD } : {}),
    maintenance: {
      db: deps.maintDb ?? db,
      storage,
      queue,
      logger,
      ...(deps.dumpDatabase ? { dumpDatabase: deps.dumpDatabase } : {}),
      ...(env.BACKUP_AGE_RECIPIENT ? { backupRecipient: env.BACKUP_AGE_RECIPIENT } : {}),
    },
  });
  return container;
}

/** R2 (or MinIO) from the environment; attachment routes answer 503 when unset. */
function storageFromEnv(env: Env, logger: Logger): Storage {
  const endpoint =
    env.R2_ENDPOINT ??
    (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  if (!endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    logger.warn('R2 is not configured; attachments are unavailable');
    return new UnconfiguredStorage();
  }
  return new S3Storage({
    endpoint,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: env.R2_REGION,
  });
}
