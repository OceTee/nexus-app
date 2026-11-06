// Opens nexus.db once (WAL, foreign keys) and runs migrations. Repositories
// use the module-level handle so the sync engine can run outside React.

import { openDatabaseAsync } from 'expo-sqlite';
import { migrate } from './migrations';
import type { SqlDb } from './sql';

let handle: SqlDb | undefined;
let opening: Promise<SqlDb> | undefined;

export function openDatabase(): Promise<SqlDb> {
  opening ??= (async () => {
    const db = await openDatabaseAsync('nexus.db');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const sqlDb = db as unknown as SqlDb;
    await migrate(sqlDb);
    handle = sqlDb;
    return sqlDb;
  })();
  return opening;
}

/** The open database; call after `openDatabase()` resolved (the root layout waits for it). */
export function getDb(): SqlDb {
  if (!handle) throw new Error('Database not open yet');
  return handle;
}

/** Tests inject an in-memory database. */
export function setDbForTests(db: SqlDb): void {
  handle = db;
  opening = Promise.resolve(db);
}
