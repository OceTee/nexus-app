import { LIMITS } from '@nexus/shared';
import { uuidv7 } from '../../infra/ids';
import { transaction, type SqlDb } from '../../infra/sql';
import { events } from '../events';
import type { CollectionRow } from '../rows';
import type { OutboxRepo } from './outbox';

export interface Collection {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  sortOrder: number;
  noteCount: number;
  serverRev: number;
}

export class CollectionPlacementError extends Error {
  constructor(public readonly code: 'DEPTH_EXCEEDED' | 'CYCLE') {
    super(
      code === 'CYCLE'
        ? 'A collection cannot go inside itself'
        : `Collections nest at most ${LIMITS.collectionDepthMax} deep`,
    );
    this.name = 'CollectionPlacementError';
  }
}

const now = () => new Date().toISOString();

export class CollectionsRepo {
  constructor(
    private readonly db: () => SqlDb,
    private readonly outbox: OutboxRepo,
  ) {}

  async list(): Promise<Collection[]> {
    const rows = await this.db().getAllAsync<CollectionRow & { note_count: number }>(
      `SELECT c.*, (SELECT count(*) FROM notes n WHERE n.collection_id = c.id AND n.deleted_at IS NULL) AS note_count
       FROM collections c WHERE c.deleted_at IS NULL ORDER BY c.sort_order, c.name`,
    );
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      icon: r.icon,
      sortOrder: r.sort_order,
      noteCount: Number(r.note_count),
      serverRev: r.server_rev,
    }));
  }

  async get(id: string): Promise<Collection | null> {
    return (await this.list()).find((c) => c.id === id) ?? null;
  }

  /** Creates, renames or moves a collection; depth ≤ 6 and no cycles (BR-07). */
  async save(input: {
    id?: string;
    name: string;
    parentId?: string | null;
    icon?: string | null;
    sortOrder?: number;
  }): Promise<string> {
    const id = input.id ?? uuidv7();
    await transaction(this.db(), async (tx) => {
      const current = await tx.getFirstAsync<CollectionRow>(
        `SELECT * FROM collections WHERE id = ?`,
        [id],
      );
      const parentId = input.parentId === undefined ? (current?.parent_id ?? null) : input.parentId;
      if (parentId) await assertPlacement(tx, id, parentId);
      const fields = {
        name: input.name.trim(),
        icon: input.icon === undefined ? (current?.icon ?? null) : input.icon,
        sortOrder: input.sortOrder ?? current?.sort_order ?? 0,
      };
      const ts = now();
      if (current) {
        await tx.runAsync(
          `UPDATE collections SET name = ?, parent_id = ?, icon = ?, sort_order = ?, local_rev = local_rev + 1,
             dirty = 1, updated_at = ? WHERE id = ?`,
          [fields.name, parentId, fields.icon, fields.sortOrder, ts, id],
        );
      } else {
        await tx.runAsync(
          `INSERT INTO collections (id, parent_id, name, icon, sort_order, local_rev, dirty, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
          [id, parentId, fields.name, fields.icon, fields.sortOrder, ts, ts],
        );
      }
      await this.outbox.enqueue(tx, {
        entityType: 'collection',
        entityId: id,
        op: 'upsert',
        baseRev: current?.server_rev ?? 0,
        payload: { parentId, name: fields.name, icon: fields.icon, sortOrder: fields.sortOrder },
      });
    });
    events.emit('collections', 'outbox');
    return id;
  }

  /** Deletes a collection; its notes and children move to the parent (BR-08). */
  async remove(id: string): Promise<void> {
    await transaction(this.db(), async (tx) => {
      const row = await tx.getFirstAsync<CollectionRow>(`SELECT * FROM collections WHERE id = ?`, [
        id,
      ]);
      if (!row || row.deleted_at) return;
      const ts = now();
      await tx.runAsync(`UPDATE notes SET collection_id = ? WHERE collection_id = ?`, [
        row.parent_id,
        id,
      ]);
      await tx.runAsync(
        `UPDATE collections SET parent_id = ? WHERE parent_id = ? AND deleted_at IS NULL`,
        [row.parent_id, id],
      );
      await tx.runAsync(
        `UPDATE collections SET deleted_at = ?, local_rev = local_rev + 1, dirty = 1 WHERE id = ?`,
        [ts, id],
      );
      // The server applies the same moves when it receives the delete.
      await this.outbox.enqueue(tx, {
        entityType: 'collection',
        entityId: id,
        op: 'delete',
        baseRev: row.server_rev,
        payload: {},
        knownToServer: row.server_rev > 0,
      });
    });
    events.emit('collections', 'notes', 'outbox');
  }
}

async function assertPlacement(tx: SqlDb, id: string, parentId: string): Promise<void> {
  if (parentId === id) throw new CollectionPlacementError('CYCLE');
  const up = await tx.getAllAsync<{ id: string; depth: number }>(
    `WITH RECURSIVE up(id, parent_id, depth) AS (
       SELECT id, parent_id, 1 FROM collections WHERE id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT c.id, c.parent_id, up.depth + 1 FROM collections c JOIN up ON c.id = up.parent_id
       WHERE up.depth < 64)
     SELECT id, depth FROM up`,
    [parentId],
  );
  if (up.some((r) => r.id === id)) throw new CollectionPlacementError('CYCLE');
  const height = await tx.getFirstAsync<{ h: number }>(
    `WITH RECURSIVE down(id, h) AS (
       SELECT id, 1 FROM collections WHERE id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT c.id, down.h + 1 FROM collections c JOIN down ON c.parent_id = down.id
       WHERE c.deleted_at IS NULL AND down.h < 64)
     SELECT coalesce(max(h), 1) AS h FROM down`,
    [id],
  );
  const parentDepth = Math.max(0, ...up.map((r) => Number(r.depth)));
  if (parentDepth + Number(height?.h ?? 1) > LIMITS.collectionDepthMax) {
    throw new CollectionPlacementError('DEPTH_EXCEEDED');
  }
}
