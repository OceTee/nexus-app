import type { SqlDb } from '../sql';
import { m0001_init } from './0001_init';

export interface Migration {
  version: number;
  up: string[];
}

/** Ordered client migrations; append only. */
export const MIGRATIONS: Migration[] = [{ version: 1, up: m0001_init }];

export const SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;

/**
 * Applies missing migrations in one exclusive transaction and records the
 * version in `sync_state.schema_version` (TDD Section G, Local database).
 * Returns the version the database is now at.
 */
export async function migrate(db: SqlDb, migrations: Migration[] = MIGRATIONS): Promise<number> {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = 'schema_version'`,
  );
  const current = row ? Number(row.value) : 0;
  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return current;

  const target = pending.at(-1)!.version;
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const m of pending) for (const statement of m.up) await tx.execAsync(statement);
    await tx.runAsync(
      `INSERT INTO sync_state (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(target)],
    );
  });
  return target;
}
