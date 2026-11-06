// The subset of expo-sqlite's async API the data layer uses. expo-sqlite's
// SQLiteDatabase satisfies it on devices; tests use node:sqlite through the
// same interface (src/test/nodeSqlite.ts), so repositories run against real
// SQLite with FTS5 in Jest.

export type SqlValue = string | number | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlDb {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params?: SqlValue[]): Promise<SqlRunResult>;
  getFirstAsync<T>(source: string, params?: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, params?: SqlValue[]): Promise<T[]>;
  /** Runs `task` in an exclusive transaction; it commits when `task` resolves. */
  withExclusiveTransactionAsync(task: (tx: SqlDb) => Promise<void>): Promise<void>;
}

/** Runs `task` in an exclusive transaction and returns its result. */
export async function transaction<T>(db: SqlDb, task: (tx: SqlDb) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    result = await task(tx);
  });
  return result as T;
}
