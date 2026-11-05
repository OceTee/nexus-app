import { sql } from 'drizzle-orm';
import type { Db } from './client';

/** A transaction handle; repositories accept this so they always run under RLS. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction with `app.user_id` set for row-level security.
 * The setting is transaction-local (`set_config(..., true)`), so it never leaks
 * to other requests sharing a pooled connection (TDD Section H).
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new TypeError('withUser: userId must be a UUID');
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
