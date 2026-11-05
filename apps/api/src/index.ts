import { createApp } from './app';
import { loadEnv } from './config/env';
import { createLogger } from './lib/logger';

const env = loadEnv();
const logger = createLogger(env);
const app = createApp({ env, logger });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, role: env.ROLE }, 'NEXUS API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
