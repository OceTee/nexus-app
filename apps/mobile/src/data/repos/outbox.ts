// The outbox (TDD Section D, Outbox): every local write appends an op in the
// same transaction. Pending ops are coalesced so the server sees the fewest,
// correct ops; ops already in flight are never modified.

import type { SyncOp } from '@nexus/shared';
import { uuidv7 } from '../../infra/ids';
import type { SqlDb } from '../../infra/sql';
import type { OutboxRow } from '../rows';

export type EntityType = 'note' | 'collection' | 'tag' | 'note_tag' | 'attachment';
export type OutboxOp = 'upsert' | 'delete' | 'add' | 'remove';

export interface Enqueue {
  entityType: EntityType;
  entityId: string;
  op: OutboxOp;
  baseRev: number | null;
  /** The op payload (for memberships: `{ noteId, tagId }`). */
  payload: Record<string, unknown>;
  /** Whether the server has ever seen this entity (server_rev > 0). */
  knownToServer?: boolean;
}

/** Batch limits (TDD Section D): at most 100 ops or 1.5 MB per request. */
export const BATCH_MAX_OPS = 100;
export const BATCH_MAX_BYTES = 1_500_000;

const now = () => new Date().toISOString();

export class OutboxRepo {
  /** Appends or coalesces an op. Must run inside the caller's write transaction. */
  async enqueue(tx: SqlDb, e: Enqueue): Promise<void> {
    const pending = await tx.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox WHERE entity_type = ? AND entity_id = ? AND status = 'pending' ORDER BY seq`,
      [e.entityType, e.entityId],
    );

    if (e.op === 'upsert') {
      const prior = pending.find((r) => r.op === 'upsert');
      if (prior) {
        // Replace the payload; keep the original base revision and op id.
        await tx.runAsync(`UPDATE outbox SET payload = ? WHERE seq = ?`, [
          JSON.stringify(e.payload),
          prior.seq,
        ]);
        return;
      }
    }

    if (e.op === 'delete') {
      const priorUpserts = pending.filter((r) => r.op === 'upsert');
      if (priorUpserts.length > 0) {
        for (const r of priorUpserts)
          await tx.runAsync(`DELETE FROM outbox WHERE seq = ?`, [r.seq]);
        // Created and deleted while offline: the server never needs to hear of it.
        if (!e.knownToServer) return;
      }
      if (pending.some((r) => r.op === 'delete')) return;
    }

    if (e.op === 'add' || e.op === 'remove') {
      const opposite = pending.find((r) => r.op === (e.op === 'add' ? 'remove' : 'add'));
      if (opposite) {
        // Add then remove (or the reverse) while offline cancels out.
        await tx.runAsync(`DELETE FROM outbox WHERE seq = ?`, [opposite.seq]);
        return;
      }
      if (pending.some((r) => r.op === e.op)) return;
    }

    await tx.runAsync(
      `INSERT INTO outbox (op_id, entity_type, entity_id, op, payload, base_rev, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv7(), e.entityType, e.entityId, e.op, JSON.stringify(e.payload), e.baseRev, now()],
    );
  }

  /** Marks up to 100 ops / 1.5 MB in-flight, in order, and returns them as sync ops. */
  async takeBatch(
    db: SqlDb,
    maxOps = BATCH_MAX_OPS,
    maxBytes = BATCH_MAX_BYTES,
  ): Promise<SyncOp[]> {
    const rows = await db.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox WHERE status IN ('pending', 'inflight') ORDER BY seq LIMIT ?`,
      [maxOps],
    );
    const batch: OutboxRow[] = [];
    let bytes = 0;
    for (const r of rows) {
      bytes += r.payload.length + 200;
      if (batch.length > 0 && bytes > maxBytes) break;
      batch.push(r);
    }
    if (batch.length > 0) {
      await db.runAsync(
        `UPDATE outbox SET status = 'inflight', attempts = attempts + 1
         WHERE seq IN (${batch.map(() => '?').join(',')})`,
        batch.map((r) => r.seq),
      );
    }
    return batch.map(toSyncOp);
  }

  /** Removes ops the server acknowledged (applied, conflict or rejected). */
  async remove(tx: SqlDb, opIds: string[]): Promise<void> {
    if (opIds.length === 0) return;
    await tx.runAsync(
      `DELETE FROM outbox WHERE op_id IN (${opIds.map(() => '?').join(',')})`,
      opIds,
    );
  }

  /** Returns in-flight ops to pending after a failed request. */
  async release(db: SqlDb, error: string): Promise<void> {
    await db.runAsync(
      `UPDATE outbox SET status = 'pending', last_error = ? WHERE status = 'inflight'`,
      [error],
    );
  }

  async pendingCount(db: SqlDb): Promise<number> {
    const r = await db.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM outbox WHERE status != 'failed'`,
    );
    return Number(r?.n ?? 0);
  }

  async all(db: SqlDb): Promise<OutboxRow[]> {
    return db.getAllAsync<OutboxRow>(`SELECT * FROM outbox ORDER BY seq`);
  }
}

function toSyncOp(r: OutboxRow): SyncOp {
  const payload = JSON.parse(r.payload) as Record<string, unknown>;
  const base = { opId: r.op_id, createdAt: r.created_at };
  if (r.entity_type === 'note_tag') {
    return { ...base, type: `note_tag.${r.op}`, ...payload } as SyncOp;
  }
  if (r.op === 'delete') {
    return {
      ...base,
      type: `${r.entity_type}.delete`,
      entityId: r.entity_id,
      baseRev: r.base_rev ?? 0,
    } as SyncOp;
  }
  return {
    ...base,
    type: `${r.entity_type}.upsert`,
    entityId: r.entity_id,
    baseRev: r.base_rev ?? 0,
    payload,
  } as SyncOp;
}
