import { createApp } from './app';
import { loadEnv } from './config/env';
import { createDb, type DbHandle } from './db/client';
import { createLogger } from './lib/logger';

const env = loadEnv();
const logger = createLogger(env);

let database: DbHandle | undefined;
if (env.DATABASE_URL) {
  database = createDb(env.DATABASE_URL);
} else {
  logger.warn('DATABASE_URL is not set; running without a database (/readyz reports not ready)');
}

const app = createApp({ env, logger, ...(database ? { db: database.db } : {}) });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, role: env.ROLE }, 'NEXUS API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void (database?.close() ?? Promise.resolve()).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
