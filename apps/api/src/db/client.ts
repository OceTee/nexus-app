import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface DbOptions {
  /** Maximum pooled connections (Neon's pooler multiplexes these). */
  max?: number;
  /** Name shown in pg_stat_activity. */
  applicationName?: string;
}

/** Creates a pooled Drizzle client. Callers own the pool and must close it. */
export function createDb(connectionString: string, options: DbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'nexus-api',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}
