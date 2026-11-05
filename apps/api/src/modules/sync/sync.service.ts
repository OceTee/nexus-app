// POST /v1/sync, GET /v1/sync/snapshot, GET /v1/sync/status (TDD Section F).

import {
  CLIENT_SCHEMA_VERSION,
  decodeCursor,
  encodeCursor,
  type ConflictDto,
  type EntityType,
  type OpResult,
  type SnapshotPageDto,
  type SyncChange,
  type SyncPushRequest,
  type SyncResponse,
  type SyncStatusDto,
} from '@nexus/shared';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client';
import {
  attachments,
  collections,
  devices,
  notes,
  noteTags,
  noteVersions,
  opReceipts,
  tags,
} from '../../db/schema';
import { withUser, type Tx } from '../../db/withUser';
import { AppError, CursorTooOldError, ForbiddenError, ValidationError } from '../../lib/errors';
import type { JobQueue } from '../../jobs/queue';
import type { ContentEngine } from '../content/applyOps';
import { iso } from '../content/derive';
import type { ChangeFeed } from './changeFeed';

/** Oldest client schema the server still accepts (also reported by GET /v1/meta). */
export const MIN_CLIENT_SCHEMA = CLIENT_SCHEMA_VERSION;

const ENTITY_ORDER: EntityType[] = ['collection', 'tag', 'note', 'note_tag', 'attachment'];

/** Snapshot page cursor: position in the entity order, last key, and the seq to adopt. */
const SnapshotCursor = z.object({
  t: z.number().int().min(0).max(4),
  k: z.string().max(80),
  seq: z.number().int().min(0),
});

export class SyncService {
  constructor(
    private readonly db: Db,
    private readonly engine: ContentEngine,
    private readonly feed: ChangeFeed,
    private readonly queue: JobQueue,
    private readonly onChanged?: (userId: string, deviceId: string) => Promise<void>,
  ) {}

  async sync(userId: string, authDeviceId: string, req: SyncPushRequest): Promise<SyncResponse> {
    if (req.deviceId !== authDeviceId) throw new ForbiddenError();
    if (req.clientSchema < MIN_CLIENT_SCHEMA) {
      throw new AppError(426, 'CLIENT_SCHEMA_TOO_OLD', 'Update the app to keep syncing');
    }
    const ctx = { userId, deviceId: req.deviceId };

    const response = await withUser(this.db, userId, async (tx) => {
      await this.assertDevice(tx, userId, req.deviceId);
      if (req.cursor > 0 && req.cursor < (await this.feed.horizon(tx)))
        throw new CursorTooOldError();

      const results: OpResult[] = [];
      const conflicts: ConflictDto[] = [];
      let changed = false;
      for (const op of req.ops) {
        const stored = await this.receipt(tx, op.opId);
        if (stored) {
          results.push(stored); // T-19: a repeated opId returns the stored result
          continue;
        }
        const outcome = await this.engine.apply(tx, ctx, op);
        await tx
          .insert(opReceipts)
          .values({
            opId: op.opId,
            userId,
            deviceId: req.deviceId,
            status: outcome.result.status,
            result: outcome.result,
          })
          .onConflictDoNothing();
        results.push(outcome.result);
        if (outcome.conflict) conflicts.push(outcome.conflict);
        changed ||= outcome.changed;
      }

      const page = await this.feed.read(tx, userId, req.deviceId, req.cursor);
      await tx
        .update(devices)
        .set({ lastPullSeq: page.cursor, lastSeenAt: sql`now()` })
        .where(eq(devices.id, req.deviceId));
      return {
        changed,
        body: {
          results,
          changes: page.changes,
          conflicts,
          cursor: page.cursor,
          hasMore: page.hasMore,
          serverTime: new Date().toISOString(),
        } satisfies SyncResponse,
      };
    });

    if (response.changed && this.onChanged) await this.onChanged(userId, req.deviceId);
    return response.body;
  }

  /** BR-12: revoked devices cannot sync, even with a valid access token. */
  private async assertDevice(tx: Tx, userId: string, deviceId: string): Promise<void> {
    const [row] = await tx
      .select({ revokedAt: devices.revokedAt })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
    if (!row || row.revokedAt !== null) throw new ForbiddenError('DEVICE_REVOKED');
  }

  private async receipt(tx: Tx, opId: string): Promise<OpResult | null> {
    const [row] = await tx.select().from(opReceipts).where(eq(opReceipts.opId, opId));
    return row ? (row.result as OpResult) : null;
  }

  /**
   * Full current state, page by page, keyset by (entity type, key). The first
   * page fixes the change sequence the device adopts after the last page, so
   * changes made during the snapshot arrive through the next sync (T-22).
   */
  async snapshot(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<SnapshotPageDto> {
    let pos: z.infer<typeof SnapshotCursor> | undefined;
    if (cursor) {
      try {
        pos = decodeCursor(cursor, SnapshotCursor);
      } catch {
        throw new ValidationError([
          { path: ['cursor'], issue: 'invalid_cursor', message: 'Invalid cursor' },
        ]);
      }
    }
    return withUser(this.db, userId, async (tx) => {
      const seq = pos?.seq ?? (await this.feed.serverSeq(tx, userId));
      const items: SnapshotPageDto['items'] = [];
      let t = pos?.t ?? 0;
      let after = pos?.k ?? '';

      while (t < ENTITY_ORDER.length && items.length < limit) {
        const type = ENTITY_ORDER[t]!;
        const keys = await this.snapshotKeys(tx, type, after, limit - items.length + 1);
        const take = keys.slice(0, limit - items.length);
        const hydrated = await this.feed.hydrate(
          tx,
          take.map((key) => ({
            changeSeq: seq,
            userId,
            entityType: type,
            entityId: type === 'note_tag' ? null : key,
            entityKey: key,
            op: 'upsert' as const,
            rev: 0,
            deviceId: null,
            createdAt: new Date().toISOString(),
          })),
        );
        for (const change of hydrated) {
          const rev = (change.data as { serverRev?: number } | null)?.serverRev ?? 1;
          items.push({ ...change, op: 'upsert', rev, seq: Math.max(1, seq) } as SyncChange & {
            op: 'upsert';
          });
        }
        if (keys.length > take.length) {
          after = take.at(-1)!; // page full mid-type: resume after the last key
          break;
        }
        t += 1;
        after = '';
      }

      // A full page may end exactly at the end of the data: skip empty types so
      // the last page says hasMore: false instead of sending an empty page.
      while (
        t < ENTITY_ORDER.length &&
        (await this.snapshotKeys(tx, ENTITY_ORDER[t]!, after, 1)).length === 0
      ) {
        t += 1;
        after = '';
      }

      const done = t >= ENTITY_ORDER.length;
      return {
        items,
        nextCursor: done ? null : encodeCursor({ t, k: after, seq }),
        hasMore: !done,
        changeSeq: seq,
      };
    });
  }

  private async snapshotKeys(
    tx: Tx,
    type: EntityType,
    after: string,
    limit: number,
  ): Promise<string[]> {
    switch (type) {
      case 'collection': {
        const rows = await tx
          .select({ k: collections.id })
          .from(collections)
          .where(
            and(
              isNull(collections.deletedAt),
              after ? gt(sql`${collections.id}::text`, after) : undefined,
            ),
          )
          .orderBy(sql`${collections.id}::text`)
          .limit(limit);
        return rows.map((r) => r.k);
      }
      case 'tag': {
        const rows = await tx
          .select({ k: tags.id })
          .from(tags)
          .where(and(isNull(tags.deletedAt), after ? gt(sql`${tags.id}::text`, after) : undefined))
          .orderBy(sql`${tags.id}::text`)
          .limit(limit);
        return rows.map((r) => r.k);
      }
      case 'note': {
        // Trashed notes are included so Trash survives a re-bootstrap.
        const rows = await tx
          .select({ k: notes.id })
          .from(notes)
          .where(after ? gt(sql`${notes.id}::text`, after) : undefined)
          .orderBy(sql`${notes.id}::text`)
          .limit(limit);
        return rows.map((r) => r.k);
      }
      case 'note_tag': {
        const key = sql<string>`${noteTags.noteId}::text || ':' || ${noteTags.tagId}::text`;
        const rows = await tx
          .select({ k: key })
          .from(noteTags)
          .where(and(isNull(noteTags.deletedAt), after ? sql`${key} > ${after}` : undefined))
          .orderBy(key)
          .limit(limit);
        return rows.map((r) => r.k);
      }
      case 'attachment': {
        const rows = await tx
          .select({ k: attachments.id })
          .from(attachments)
          .where(
            and(
              or(eq(attachments.status, 'uploaded'), eq(attachments.status, 'pending')),
              after ? gt(sql`${attachments.id}::text`, after) : undefined,
            ),
          )
          .orderBy(sql`${attachments.id}::text`)
          .limit(limit);
        return rows.map((r) => r.k);
      }
    }
  }

  async status(userId: string): Promise<SyncStatusDto> {
    return withUser(this.db, userId, async (tx) => {
      const [serverSeq, horizonSeq] = await Promise.all([
        this.feed.serverSeq(tx, userId),
        this.feed.horizon(tx),
      ]);
      const devs = await tx
        .select({
          id: devices.id,
          name: devices.name,
          lastPullSeq: devices.lastPullSeq,
          lastSeenAt: devices.lastSeenAt,
        })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.createdAt);
      const [open] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(noteVersions)
        .where(and(eq(noteVersions.conflict, true), isNull(noteVersions.resolvedAt)));
      return {
        serverSeq,
        horizonSeq,
        devices: devs.map((d) => ({
          ...d,
          lastPullSeq: Number(d.lastPullSeq),
          lastSeenAt: iso(d.lastSeenAt),
        })),
        openConflicts: Number(open?.n ?? 0),
      };
    });
  }
}
