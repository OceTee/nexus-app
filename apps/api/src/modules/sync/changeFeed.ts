// The change feed (TDD Section D, Push and pull; Section F, Transaction
// handling). One row per accepted change; devices pull rows after their
// cursor. Rows from the last 2 seconds are held back unless an older row has a
// higher sequence, so a bigserial value that commits late is never skipped
// (risk R-02).

import type { EntityType, SyncChange } from '@nexus/shared';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { changes, syncStateServer } from '../../db/schema';
import type { Tx } from '../../db/withUser';
import {
  loadAttachments,
  loadCollections,
  loadMembership,
  loadNotes,
  loadTags,
} from '../content/loaders';
import { iso } from '../content/derive';

export interface ChangeInput {
  userId: string;
  entityType: EntityType;
  entityId: string | null;
  entityKey: string;
  op: 'upsert' | 'delete';
  rev: number;
  deviceId: string | null;
}

export interface FeedPage {
  changes: SyncChange[];
  /** Highest sequence the device has now seen (own rows included). */
  cursor: number;
  hasMore: boolean;
}

export const FEED_PAGE_SIZE = 500;

export class ChangeFeed {
  /** @param visibilityLagMs hold-back window for late commits (2 s in production). */
  constructor(private readonly visibilityLagMs = 2000) {}

  async append(tx: Tx, change: ChangeInput): Promise<void> {
    await tx.insert(changes).values(change);
  }

  async horizon(tx: Tx): Promise<number> {
    const [row] = await tx.select({ seq: syncStateServer.horizonSeq }).from(syncStateServer);
    return row?.seq ?? 0;
  }

  async serverSeq(tx: Tx, userId: string): Promise<number> {
    const [row] = await tx
      .select({ seq: sql<number>`coalesce(max(${changes.changeSeq}), 0)::bigint` })
      .from(changes)
      .where(eq(changes.userId, userId));
    return Number(row?.seq ?? 0);
  }

  /** Reads changes after `cursor`, skipping the device's own rows but advancing past them. */
  async read(
    tx: Tx,
    userId: string,
    deviceId: string | null,
    cursor: number,
    limit = FEED_PAGE_SIZE,
  ): Promise<FeedPage> {
    const lag = sql`(${Math.max(0, Math.floor(this.visibilityLagMs))} * interval '1 millisecond')`;
    const rows = await tx
      .select()
      .from(changes)
      .where(
        and(
          eq(changes.userId, userId),
          gt(changes.changeSeq, cursor),
          sql`(${changes.createdAt} < now() - ${lag}
               OR ${changes.changeSeq} <= (SELECT coalesce(max(c2.change_seq), 0) FROM changes c2
                                           WHERE c2.user_id = ${userId} AND c2.created_at < now() - ${lag}))`,
        ),
      )
      .orderBy(changes.changeSeq)
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const visible = page.filter((r) => deviceId === null || r.deviceId !== deviceId);
    return {
      changes: await this.hydrate(tx, visible),
      cursor: page.at(-1)?.changeSeq ?? cursor,
      hasMore: rows.length > limit,
    };
  }

  /** Attaches the entity's current state to each change (null when gone). */
  async hydrate(tx: Tx, rows: (typeof changes.$inferSelect)[]): Promise<SyncChange[]> {
    const ids = (type: EntityType) => [
      ...new Set(rows.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!)),
    ];
    const [noteMap, collectionMap, tagMap, attachmentMap] = await Promise.all([
      loadNotes(tx, ids('note')),
      loadCollections(tx, ids('collection')),
      loadTags(tx, ids('tag')),
      loadAttachments(tx, ids('attachment')),
    ]);

    const out: SyncChange[] = [];
    for (const r of rows) {
      let data: unknown = null;
      switch (r.entityType) {
        case 'note':
          data = noteMap.get(r.entityId!) ?? null;
          break;
        case 'collection':
          data = collectionMap.get(r.entityId!) ?? null;
          break;
        case 'tag':
          data = tagMap.get(r.entityId!) ?? null;
          break;
        case 'attachment':
          data = attachmentMap.get(r.entityId!) ?? null;
          break;
        case 'note_tag': {
          const [noteId, tagId] = r.entityKey.split(':') as [string, string];
          const m = await loadMembership(tx, noteId, tagId);
          data = m
            ? { noteId, tagId, createdAt: iso(m.createdAt), deletedAt: iso(m.deletedAt) }
            : null;
          break;
        }
      }
      out.push({
        seq: r.changeSeq,
        entityType: r.entityType,
        entityKey: r.entityKey,
        op: r.op,
        rev: r.rev,
        data,
      });
    }
    return out;
  }

  /** Changes of the listed sequence numbers (used by tests and status). */
  async bySeq(tx: Tx, seqs: number[]) {
    return seqs.length ? tx.select().from(changes).where(inArray(changes.changeSeq, seqs)) : [];
  }
}
