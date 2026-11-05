import { existsSync, readFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';

/**
 * Folder with the committed SQL migrations and Drizzle's journal. Resolved
 * from the source tree (src/db) or the bundle (dist), or MIGRATIONS_DIR.
 */
export const MIGRATIONS_FOLDER =
  process.env.MIGRATIONS_DIR ??
  [
    new URL('../../drizzle/migrations', import.meta.url),
    new URL('../drizzle/migrations', import.meta.url),
  ]
    .map((u) => fileURLToPath(u))
    .find((p) => existsSync(p)) ??
  fileURLToPath(new URL('../../drizzle/migrations', import.meta.url));

/** Number of migrations in the committed journal. */
export function expectedMigrationCount(folder: string = MIGRATIONS_FOLDER): number {
  const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8')) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

/**
 * Applies pending migrations as the schema owner. Idempotent: already-applied
 * migrations are skipped using Drizzle's journal table (TDD T-34).
 */
export async function runMigrations(
  connectionString: string,
  folder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const handle = createDb(connectionString, { max: 1, applicationName: 'nexus-migrate' });
  try {
    await migrate(handle.db, { migrationsFolder: folder });
  } finally {
    await handle.close();
  }
}
