import { createHash } from 'node:crypto';
import { LogSender } from './integrations/email';
import express, { Router, type Express, type Request, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env';
import type { Container } from './container';
import type { Db } from './db/client';
import { expectedMigrationCount } from './db/migrate';
import { checkReadiness } from './db/readiness';
import { requireAuth } from './http/middleware/auth';
import { errorHandler, notFound } from './http/middleware/errorHandler';
import { byIp, byUserOrIp, rateLimit } from './http/middleware/rateLimit';
import { requestId } from './http/middleware/requestId';
import { security } from './http/middleware/security';
import { systemRouter } from './http/router';
import { AppError } from './lib/errors';
import { accountRouter } from './modules/account/account.router';
import { authRouter } from './modules/auth/auth.router';
import { devicesRouter } from './modules/devices/devices.router';
import { collectionsRouter } from './modules/collections/collections.router';
import { graphAndSearchRouter } from './modules/graph/graph.router';
import { notesRouter } from './modules/notes/notes.router';
import { syncRouter } from './modules/sync/sync.router';
import { tagsRouter } from './modules/tags/tags.router';
import { attachmentsRouter } from './modules/attachments/attachments.router';
import { exportsRouter } from './modules/exports/exports.router';

export interface AppDeps {
  env: Env;
  logger: Logger;
  /** Database client; optional so the HTTP layer can be tested without Postgres. */
  db?: Db;
  /** Services; when absent only the system routes are mounted. */
  container?: Container;
}

const userHash = (userId: string) => createHash('sha256').update(userId).digest('hex').slice(0, 12);

/** API responses are private and never cached (TDD Section H, API security). */
const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** Bodies must be JSON (415 otherwise). */
const jsonOnly: RequestHandler = (req, _res, next) => {
  const hasBody =
    Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding') !== undefined;
  if (hasBody && !req.is('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request bodies must be application/json');
  }
  next();
};

/** Express app factory, used by src/index.ts and by tests. */
export function createApp({ env, logger, db, container }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).id,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      // One line per request: method, path, status, duration, request id,
      // hashed user id and device id. No headers or bodies.
      customProps: (req) => {
        const auth = (req as Request).auth;
        return auth ? { userHash: userHash(auth.userId), deviceId: auth.deviceId } : {};
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(security(env.CORS_ORIGINS));
  app.use('/v1', noStore, jsonOnly);
  // 2 MB for sync batches and note bodies; 64 KB everywhere else (TDD Section H).
  app.use(['/v1/sync', '/v1/notes'], express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '64kb' }));

  const database = db ?? container?.db;
  const expected = database ? expectedMigrationCount() : 0;
  app.use(systemRouter(database ? { readiness: () => checkReadiness(database, expected) } : {}));

  if (container) {
    const { limiters, signer } = container;
    const authed = requireAuth(signer);
    const general = rateLimit(limiters.general, byUserOrIp);

    app.use(
      '/v1/auth',
      rateLimit(limiters.general, byIp),
      authRouter(container.auth, limiters, authed),
    );

    // E2E runs only (refused in production by the env schema).
    if (env.E2E_MODE && container.email instanceof LogSender) {
      const sender = container.email;
      app.get('/v1/dev/emails/last', (req, res) => {
        const to = typeof req.query.to === 'string' ? req.query.to : '';
        const mail = sender.last(to);
        if (!mail) {
          res
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'No email', requestId: req.id } });
          return;
        }
        res.json(mail);
      });
    }

    const protectedRoutes = Router();
    protectedRoutes.use(authed, general);
    protectedRoutes.use('/me', accountRouter(container.account));
    protectedRoutes.use('/devices', devicesRouter(container.devices));
    protectedRoutes.use('/sync', syncRouter(container.sync, limiters));
    protectedRoutes.use('/notes', notesRouter(container.notes));
    protectedRoutes.use('/collections', collectionsRouter(container.collections));
    protectedRoutes.use('/tags', tagsRouter(container.tags));
    protectedRoutes.use('/attachments', attachmentsRouter(container.attachments, limiters));
    protectedRoutes.use('/exports', exportsRouter(container.exports, limiters));
    protectedRoutes.use(graphAndSearchRouter(container.graph, container.search));
    app.use('/v1', protectedRoutes);
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
