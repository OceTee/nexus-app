import express, { type Express, type Request } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env';
import { errorHandler, notFound } from './http/middleware/errorHandler';
import { requestId } from './http/middleware/requestId';
import { security } from './http/middleware/security';
import { systemRouter } from './http/router';

export interface AppDeps {
  env: Env;
  logger: Logger;
}

/** Express app factory, used by src/index.ts and by tests. */
export function createApp({ env, logger }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).id,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      // One line per request: method, path, status, duration and request id. No headers or bodies.
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
  app.use(express.json({ limit: '64kb' }));

  app.use(systemRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
