import type { Server } from 'node:http';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createContainer, type Container } from './container';
import { createDb, type DbHandle } from './db/client';
import { PgBossQueue, type JobQueue } from './jobs/queue';
import { createLogger } from './lib/logger';

const env = loadEnv();
const logger = createLogger(env);

let database: DbHandle | undefined;
let queue: JobQueue | undefined;
let container: Container | undefined;

if (env.DATABASE_URL) {
  database = createDb(env.DATABASE_URL);
  const jobsUrl = env.JOBS_DATABASE_URL ?? env.DATABASE_URL_DIRECT;
  if (!jobsUrl) {
    throw new Error('Set JOBS_DATABASE_URL (or DATABASE_URL_DIRECT) for the job queue.');
  }
  queue = new PgBossQueue(jobsUrl, logger);
  container = createContainer({ env, logger, db: database.db, pool: database.pool, queue });
  if (env.ROLE !== 'api') {
    await queue.work(container.jobHandlers);
    logger.info('job workers started');
  }
} else {
  logger.warn('DATABASE_URL is not set; running without a database (/readyz reports not ready)');
}

let server: Server | undefined;
if (env.ROLE !== 'worker') {
  const app = createApp({
    env,
    logger,
    ...(database ? { db: database.db } : {}),
    ...(container ? { container } : {}),
  });
  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, role: env.ROLE }, 'NEXUS API listening');
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), 10_000).unref();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await queue?.stop();
  await database?.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
