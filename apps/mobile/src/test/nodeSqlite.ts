/// <reference types="node" />
// node:sqlite behind the SqlDb interface, so repositories run against real
// SQLite (with FTS5) in Jest instead of a mock.

import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../infra/migrations';
import type { SqlDb, SqlRunResult, SqlValue } from '../infra/sql';

class NodeSqlDb implements SqlDb {
  private depth = 0;

  constructor(private readonly db: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.db.exec(source);
  }

  async runAsync(source: string, params: SqlValue[] = []): Promise<SqlRunResult> {
    const r = this.db.prepare(source).run(...params);
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }

  async getFirstAsync<T>(source: string, params: SqlValue[] = []): Promise<T | null> {
    return (this.db.prepare(source).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(source: string, params: SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(source).all(...params) as T[];
  }

  async withExclusiveTransactionAsync(task: (tx: SqlDb) => Promise<void>): Promise<void> {
    // Nested calls join the outer transaction, as a savepoint would.
    if (this.depth > 0) return task(this);
    this.db.exec('BEGIN EXCLUSIVE');
    this.depth += 1;
    try {
      await task(this);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

/** A fresh, migrated in-memory database. */
export async function createTestDb(): Promise<SqlDb> {
  const db = new NodeSqlDb(new DatabaseSync(':memory:'));
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}
