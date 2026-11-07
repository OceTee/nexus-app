// Opens nexus.db once (WAL, foreign keys) and runs migrations. Repositories
// use the module-level handle so the sync engine can run outside React.

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { migrate } from './migrations';
import type { SqlDb } from './sql';

let handle: SqlDb | undefined;
let opening: Promise<SqlDb> | undefined;

const LOCK_RETRIES = 6;
const isLocked = (e: unknown) => /database is locked|SQLITE_BUSY|Error code 5\b/i.test(String(e));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * expo-sqlite runs each exclusive transaction on a connection of its own, so
 * two transactions (an autosave and a sync batch, say) or a transaction and a
 * plain write can meet a locked database. Transactions are therefore queued
 * and run one at a time, a transaction that still finds the database busy is
 * retried (its writes were rolled back), and the main connection waits for
 * locks instead of failing at once.
 */
function serialised(db: SQLiteDatabase): SqlDb {
  const raw = db as unknown as SqlDb;
  let tail: Promise<unknown> = Promise.resolve();
  const runWithRetry = async (task: (tx: SqlDb) => Promise<void>) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await raw.withExclusiveTransactionAsync(task);
        return;
      } catch (e) {
        if (!isLocked(e) || attempt >= LOCK_RETRIES) throw e;
        await pause(50 * 2 ** attempt);
      }
    }
  };
  return {
    execAsync: (s) => raw.execAsync(s),
    runAsync: (s, p) => raw.runAsync(s, p),
    getFirstAsync: (s, p) => raw.getFirstAsync(s, p),
    getAllAsync: (s, p) => raw.getAllAsync(s, p),
    withExclusiveTransactionAsync(task) {
      const run = tail.then(() => runWithRetry(task));
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

export function openDatabase(): Promise<SqlDb> {
  opening ??= (async () => {
    const db = await openDatabaseAsync('nexus.db');
    await db.execAsync(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
    );
    const sqlDb = serialised(db);
    await migrate(sqlDb);
    handle = sqlDb;
    return sqlDb;
  })();
  // A failed open is forgotten, so "Try again" really tries again.
  opening.catch(() => {
    opening = undefined;
  });
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
