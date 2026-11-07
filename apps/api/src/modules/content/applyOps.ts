// The op engine (TDD Sections D and F). Every content change, from the sync
// endpoint or from REST, goes through `apply`, so both paths behave the same.
//
// Each op runs in its own savepoint: a rejected op (not found, duplicate,
// depth) rolls back only itself and the batch continues (Section F,
// Transaction handling). A conflict is not an error: the server copy stays,
// the client copy is kept as a conflict version.

import {
  LIMITS,
  applyMembershipOp,
  type ConflictDto,
  type OpResult,
  type SyncOp,
} from '@nexus/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { attachments, collections, notes, noteTags, noteVersions, tags } from '../../db/schema';
import type { Tx } from '../../db/withUser';
import type { ChangeFeed } from '../sync/changeFeed';
import type { LinksService } from '../links/links.service';
import { isUnstorableText } from '../../lib/errors';
import { deriveNoteFields, iso } from './derive';

export interface OpContext {
  userId: string;
  /** Device that sent the op (null for server-side tools). */
  deviceId: string | null;
}

export interface ApplyOutcome {
  result: OpResult;
  conflict?: ConflictDto;
  /** True when server state changed (used to nudge other devices). */
  changed: boolean;
}

/** A rejection: recorded in the op result, never thrown out of `apply`. */
export class OpRejected extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const notFound = (what: string) => new OpRejected('NOT_FOUND', `${what} not found`);

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

export class ContentEngine {
  constructor(
    private readonly feed: ChangeFeed,
    private readonly links: LinksService,
  ) {}

  /** Applies one op in a savepoint and reports the outcome. */
  async apply(tx: Tx, ctx: OpContext, op: SyncOp): Promise<ApplyOutcome> {
    try {
      return await tx.transaction((sp) => this.dispatch(sp as unknown as Tx, ctx, op));
    } catch (caught) {
      // Rejected alone: the savepoint is rolled back and the batch goes on, so
      // one bad op can't block a device's outbox for good.
      const err = isUnstorableText(caught)
        ? new OpRejected('VALIDATION_FAILED', 'The text contains characters that cannot be stored')
        : caught;
      if (err instanceof OpRejected) {
        return {
          result: {
            opId: op.opId,
            status: 'rejected',
            error: { code: err.code, message: err.message },
          },
          changed: false,
        };
      }
      throw err;
    }
  }

  private dispatch(tx: Tx, ctx: OpContext, op: SyncOp): Promise<ApplyOutcome> {
    switch (op.type) {
      case 'note.upsert':
        return this.noteUpsert(tx, ctx, op);
      case 'note.delete':
        return this.noteDelete(tx, ctx, op);
      case 'collection.upsert':
        return this.collectionUpsert(tx, ctx, op);
      case 'collection.delete':
        return this.collectionDelete(tx, ctx, op);
      case 'tag.upsert':
        return this.tagUpsert(tx, ctx, op);
      case 'tag.delete':
        return this.tagDelete(tx, ctx, op);
      case 'note_tag.add':
      case 'note_tag.remove':
        return this.membership(tx, ctx, op);
      case 'attachment.upsert':
        return this.attachmentUpsert(tx, ctx, op);
      case 'attachment.delete':
        return this.attachmentDelete(tx, ctx, op);
    }
  }

  private applied(op: SyncOp, serverRev?: number, changed = true): ApplyOutcome {
    return {
      result: {
        opId: op.opId,
        status: 'applied',
        ...(serverRev !== undefined ? { serverRev } : {}),
      },
      changed,
    };
  }

  // ------------------------------------------------------------------ notes

  private async noteUpsert(
    tx: Tx,
    ctx: OpContext,
    op: Extract<SyncOp, { type: 'note.upsert' }>,
  ): Promise<ApplyOutcome> {
    const { payload } = op;
    const [current] = await tx.select().from(notes).where(eq(notes.id, op.entityId)).for('update');

    const collectionId = payload.collectionId
      ? await this.liveCollectionId(tx, payload.collectionId)
      : null;
    const derived = deriveNoteFields(payload.title, payload.bodyMd);

    if (!current) {
      if (op.baseRev !== 0) throw notFound('Note'); // edited on this device, purged on the server
      try {
        await tx.insert(notes).values({
          id: op.entityId,
          userId: ctx.userId,
          title: payload.title,
          bodyMd: payload.bodyMd,
          collectionId,
          isPinned: payload.isPinned,
          lastDeviceId: ctx.deviceId,
          ...derived,
        });
      } catch (err) {
        // The id exists but belongs to someone else (hidden by RLS): TM-03.
        if (isUniqueViolation(err)) throw notFound('Note');
        throw err;
      }
      await this.insertVersion(tx, ctx, op.entityId, 1, 0, payload.title, payload.bodyMd);
      await this.links.rewrite(tx, ctx.userId, op.entityId, payload.bodyMd);
      for (const tagId of payload.tagIds) {
        await this.applyMembership(tx, ctx, op.entityId, tagId, 'add', op.createdAt, {
          skipMissingTag: true,
        });
      }
      await this.change(tx, ctx, 'note', op.entityId, 'upsert', 1);
      return this.applied(op, 1);
    }

    if (op.baseRev !== current.serverRev) {
      // Conflict rule: keep the server copy; store the client copy as a conflict version.
      const [version] = await tx
        .insert(noteVersions)
        .values({
          noteId: current.id,
          userId: ctx.userId,
          rev: current.serverRev,
          baseRev: op.baseRev,
          title: payload.title,
          bodyMd: payload.bodyMd,
          deviceId: ctx.deviceId,
          conflict: true,
        })
        .returning();
      const conflict: ConflictDto = {
        noteId: current.id,
        versionId: version!.id,
        serverRev: current.serverRev,
        deviceId: ctx.deviceId,
        createdAt: iso(version!.createdAt),
      };
      return {
        result: {
          opId: op.opId,
          status: 'conflict' as const,
          serverRev: current.serverRev,
          conflictVersionId: version!.id,
        },
        conflict,
        changed: false,
      };
    }

    const contentChanged = derived.contentHash !== current.contentHash;
    const metaChanged =
      collectionId !== current.collectionId ||
      payload.isPinned !== current.isPinned ||
      current.deletedAt !== null;
    if (!contentChanged && !metaChanged) return this.applied(op, current.serverRev, false); // BR-03

    const rev = current.serverRev + 1;
    await tx
      .update(notes)
      .set({
        title: payload.title,
        bodyMd: payload.bodyMd,
        collectionId,
        isPinned: payload.isPinned,
        serverRev: rev,
        lastDeviceId: ctx.deviceId,
        deletedAt: null,
        ...derived,
      })
      .where(eq(notes.id, current.id));
    if (contentChanged) {
      await this.insertVersion(tx, ctx, current.id, rev, op.baseRev, payload.title, payload.bodyMd);
      await this.links.rewrite(tx, ctx.userId, current.id, payload.bodyMd);
    }
    if (current.deletedAt !== null)
      await this.links.resolveTo(tx, ctx.userId, current.id, payload.title);
    await this.change(tx, ctx, 'note', current.id, 'upsert', rev);
    return this.applied(op, rev);
  }

  /** Delete wins over concurrent edits (T-57): the note moves to Trash at any base revision. */
  private async noteDelete(tx: Tx, ctx: OpContext, op: Extract<SyncOp, { type: 'note.delete' }>) {
    const [current] = await tx.select().from(notes).where(eq(notes.id, op.entityId)).for('update');
    if (!current) throw notFound('Note');
    if (current.deletedAt !== null) return this.applied(op, current.serverRev, false);
    const rev = current.serverRev + 1;
    await tx
      .update(notes)
      .set({ deletedAt: sql`now()`, serverRev: rev, lastDeviceId: ctx.deviceId })
      .where(eq(notes.id, current.id));
    await this.links.detach(tx, current.id);
    await this.change(tx, ctx, 'note', current.id, 'delete', rev);
    return this.applied(op, rev);
  }

  /** Restores a trashed note (REST `POST /notes/:id/restore`). */
  async restoreNote(tx: Tx, ctx: OpContext, noteId: string): Promise<number> {
    const [current] = await tx.select().from(notes).where(eq(notes.id, noteId)).for('update');
    if (!current) throw notFound('Note');
    if (current.deletedAt === null) return current.serverRev;
    const rev = current.serverRev + 1;
    await tx
      .update(notes)
      .set({ deletedAt: null, serverRev: rev, lastDeviceId: ctx.deviceId })
      .where(eq(notes.id, noteId));
    await this.links.resolveTo(tx, ctx.userId, noteId, current.title);
    await this.change(tx, ctx, 'note', noteId, 'upsert', rev);
    return rev;
  }

  private async insertVersion(
    tx: Tx,
    ctx: OpContext,
    noteId: string,
    rev: number,
    baseRev: number,
    title: string,
    bodyMd: string,
  ): Promise<void> {
    await tx.insert(noteVersions).values({
      noteId,
      userId: ctx.userId,
      rev,
      baseRev,
      title,
      bodyMd,
      deviceId: ctx.deviceId,
      conflict: false,
    });
  }

  private async liveCollectionId(tx: Tx, id: string): Promise<string | null> {
    const [row] = await tx
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.id, id), isNull(collections.deletedAt)));
    // A collection deleted on another device: file the note as unfiled rather than lose it.
    return row?.id ?? null;
  }

  // ------------------------------------------------------------ collections

  private async collectionUpsert(
    tx: Tx,
    ctx: OpContext,
    op: Extract<SyncOp, { type: 'collection.upsert' }>,
  ) {
    const { payload } = op;
    const [current] = await tx
      .select()
      .from(collections)
      .where(eq(collections.id, op.entityId))
      .for('update');
    const parentId = payload.parentId;
    if (parentId) await this.assertPlacement(tx, op.entityId, parentId);

    if (!current) {
      if (op.baseRev !== 0) throw notFound('Collection');
      try {
        await tx.insert(collections).values({
          id: op.entityId,
          userId: ctx.userId,
          parentId,
          name: payload.name,
          icon: payload.icon ?? null,
          sortOrder: payload.sortOrder ?? 0,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw notFound('Collection');
        throw err;
      }
      await this.change(tx, ctx, 'collection', op.entityId, 'upsert', 1);
      return this.applied(op, 1);
    }

    // Structural fields (parent, order, icon) are last-writer-wins; a stale
    // rename is the only collection conflict (TDD Section D, Conflict rule).
    const stale = op.baseRev !== current.serverRev;
    const renameConflict = stale && payload.name !== current.name;
    const next = {
      name: renameConflict ? current.name : payload.name,
      parentId,
      icon: payload.icon === undefined ? current.icon : payload.icon,
      sortOrder: payload.sortOrder ?? current.sortOrder,
    };
    const changed =
      next.name !== current.name ||
      next.parentId !== current.parentId ||
      next.icon !== current.icon ||
      next.sortOrder !== current.sortOrder ||
      current.deletedAt !== null;
    let rev = current.serverRev;
    if (changed) {
      rev += 1;
      await tx
        .update(collections)
        .set({ ...next, serverRev: rev, deletedAt: null })
        .where(eq(collections.id, current.id));
      await this.change(tx, ctx, 'collection', current.id, 'upsert', rev);
    }
    if (renameConflict) {
      return {
        result: { opId: op.opId, status: 'conflict' as const, serverRev: rev },
        changed,
      };
    }
    return this.applied(op, rev, changed);
  }

  /** BR-07: depth ≤ 6 and never under itself or a descendant. */
  async assertPlacement(tx: Tx, collectionId: string, parentId: string): Promise<void> {
    if (parentId === collectionId)
      throw new OpRejected('CYCLE', 'A collection cannot contain itself');
    const ancestry = await tx.execute<{ id: string; depth: number }>(sql`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, 1 AS depth FROM collections WHERE id = ${parentId} AND deleted_at IS NULL
        UNION ALL
        SELECT c.id, c.parent_id, up.depth + 1 FROM collections c JOIN up ON c.id = up.parent_id
        WHERE up.depth < 64
      )
      SELECT id, depth FROM up`);
    if (ancestry.rows.length === 0) throw notFound('Parent collection');
    if (ancestry.rows.some((r) => r.id === collectionId)) {
      throw new OpRejected('CYCLE', 'A collection cannot move under its own descendant');
    }
    const parentDepth = Math.max(...ancestry.rows.map((r) => Number(r.depth)));
    const subtree = await tx.execute<{ height: number }>(sql`
      WITH RECURSIVE down AS (
        SELECT id, 1 AS height FROM collections WHERE id = ${collectionId} AND deleted_at IS NULL
        UNION ALL
        SELECT c.id, down.height + 1 FROM collections c JOIN down ON c.parent_id = down.id
        WHERE c.deleted_at IS NULL AND down.height < 64
      )
      SELECT coalesce(max(height), 1) AS height FROM down`);
    const height = Number(subtree.rows[0]?.height ?? 1);
    if (parentDepth + height > LIMITS.collectionDepthMax) {
      throw new OpRejected(
        'DEPTH_EXCEEDED',
        `Collections nest at most ${LIMITS.collectionDepthMax} deep`,
      );
    }
  }

  /** BR-08: notes move to the parent (or unfiled), children move up; notes are never deleted. */
  private async collectionDelete(
    tx: Tx,
    ctx: OpContext,
    op: Extract<SyncOp, { type: 'collection.delete' }>,
  ) {
    const [current] = await tx
      .select()
      .from(collections)
      .where(eq(collections.id, op.entityId))
      .for('update');
    if (!current) throw notFound('Collection');
    if (current.deletedAt !== null) return this.applied(op, current.serverRev, false);

    const movedNotes = await tx
      .update(notes)
      .set({ collectionId: current.parentId, serverRev: sql`${notes.serverRev} + 1` })
      .where(eq(notes.collectionId, current.id))
      .returning({ id: notes.id, rev: notes.serverRev });
    for (const n of movedNotes) await this.change(tx, ctx, 'note', n.id, 'upsert', n.rev);

    const movedChildren = await tx
      .update(collections)
      .set({ parentId: current.parentId, serverRev: sql`${collections.serverRev} + 1` })
      .where(and(eq(collections.parentId, current.id), isNull(collections.deletedAt)))
      .returning({ id: collections.id, rev: collections.serverRev });
    for (const c of movedChildren) await this.change(tx, ctx, 'collection', c.id, 'upsert', c.rev);

    const rev = current.serverRev + 1;
    await tx
      .update(collections)
      .set({ deletedAt: sql`now()`, serverRev: rev })
      .where(eq(collections.id, current.id));
    await this.change(tx, ctx, 'collection', current.id, 'delete', rev);
    return this.applied(op, rev);
  }

  // ------------------------------------------------------------------- tags

  private async tagUpsert(tx: Tx, ctx: OpContext, op: Extract<SyncOp, { type: 'tag.upsert' }>) {
    const { payload } = op;
    const [clash] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(sql`${tags.nameNorm} = lower(${payload.name})`, isNull(tags.deletedAt)));
    if (clash && clash.id !== op.entityId) {
      throw new OpRejected('DUPLICATE', `tag '${payload.name}' already exists`); // BR-09
    }

    const [current] = await tx.select().from(tags).where(eq(tags.id, op.entityId)).for('update');
    if (!current) {
      if (op.baseRev !== 0) throw notFound('Tag');
      try {
        await tx.insert(tags).values({
          id: op.entityId,
          userId: ctx.userId,
          name: payload.name,
          colour: payload.colour ?? null,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw notFound('Tag');
        throw err;
      }
      await this.change(tx, ctx, 'tag', op.entityId, 'upsert', 1);
      return this.applied(op, 1);
    }

    const colour = payload.colour === undefined ? current.colour : payload.colour;
    if (payload.name === current.name && colour === current.colour && current.deletedAt === null) {
      return this.applied(op, current.serverRev, false);
    }
    const rev = current.serverRev + 1;
    await tx
      .update(tags)
      .set({ name: payload.name, colour, serverRev: rev, deletedAt: null })
      .where(eq(tags.id, current.id));
    await this.change(tx, ctx, 'tag', current.id, 'upsert', rev);
    return this.applied(op, rev);
  }

  private async tagDelete(tx: Tx, ctx: OpContext, op: Extract<SyncOp, { type: 'tag.delete' }>) {
    const [current] = await tx.select().from(tags).where(eq(tags.id, op.entityId)).for('update');
    if (!current) throw notFound('Tag');
    if (current.deletedAt !== null) return this.applied(op, current.serverRev, false);
    const rev = current.serverRev + 1;
    await tx
      .update(tags)
      .set({ deletedAt: sql`now()`, serverRev: rev })
      .where(eq(tags.id, current.id));
    await tx
      .update(noteTags)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(noteTags.tagId, current.id), isNull(noteTags.deletedAt)));
    await this.change(tx, ctx, 'tag', current.id, 'delete', rev);
    return this.applied(op, rev);
  }

  // ------------------------------------------------------------ memberships

  private async membership(
    tx: Tx,
    ctx: OpContext,
    op: Extract<SyncOp, { type: 'note_tag.add' | 'note_tag.remove' }>,
  ) {
    const kind = op.type === 'note_tag.add' ? 'add' : 'remove';
    const changed = await this.applyMembership(tx, ctx, op.noteId, op.tagId, kind, op.createdAt);
    return this.applied(op, undefined, changed);
  }

  /** Set-merge (BR-10, T-05, T-06) via the shared rules. Returns whether state changed. */
  async applyMembership(
    tx: Tx,
    ctx: OpContext,
    noteId: string,
    tagId: string,
    kind: 'add' | 'remove',
    createdAt: string,
    opts: { skipMissingTag?: boolean } = {},
  ): Promise<boolean> {
    const [note] = await tx.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId));
    if (!note) throw notFound('Note');
    const [tag] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.id, tagId), isNull(tags.deletedAt)));
    if (!tag) {
      if (opts.skipMissingTag) return false;
      throw notFound('Tag');
    }

    const [row] = await tx
      .select()
      .from(noteTags)
      .where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId)))
      .for('update');
    const current = row ? { createdAt: iso(row.createdAt), deletedAt: iso(row.deletedAt) } : null;
    const outcome = applyMembershipOp(current, { kind, createdAt });
    if (!outcome.changed) return false;

    await tx
      .insert(noteTags)
      .values({
        noteId,
        tagId,
        userId: ctx.userId,
        createdAt: outcome.next.createdAt,
        deletedAt: outcome.next.deletedAt,
      })
      .onConflictDoUpdate({
        target: [noteTags.noteId, noteTags.tagId],
        set: { createdAt: outcome.next.createdAt, deletedAt: outcome.next.deletedAt },
      });
    await this.feed.append(tx, {
      userId: ctx.userId,
      entityType: 'note_tag',
      entityId: null,
      entityKey: `${noteId}:${tagId}`,
      op: outcome.next.deletedAt === null ? 'upsert' : 'delete',
      rev: 1,
      deviceId: ctx.deviceId,
    });
    return true;
  }

  // ------------------------------------------------------------ attachments

  /** Metadata updates for attachments created through `POST /v1/attachments`. */
  private async attachmentUpsert(
    tx: Tx,
    ctx: OpContext,
    op: Extract<SyncOp, { type: 'attachment.upsert' }>,
  ) {
    const [current] = await tx
      .select()
      .from(attachments)
      .where(eq(attachments.id, op.entityId))
      .for('update');
    if (!current || current.status === 'deleted') throw notFound('Attachment');
    const noteId = op.payload.noteId;
    if (noteId === current.noteId && op.payload.filename === current.filename) {
      return this.applied(op, current.serverRev, false);
    }
    const rev = current.serverRev + 1;
    await tx
      .update(attachments)
      .set({ noteId, filename: op.payload.filename, serverRev: rev })
      .where(eq(attachments.id, current.id));
    await this.change(tx, ctx, 'attachment', current.id, 'upsert', rev);
    return this.applied(op, rev);
  }

  private async attachmentDelete(
    tx: Tx,
    ctx: OpContext,
    op: Extract<SyncOp, { type: 'attachment.delete' }>,
  ) {
    const [current] = await tx
      .select()
      .from(attachments)
      .where(eq(attachments.id, op.entityId))
      .for('update');
    if (!current) throw notFound('Attachment');
    if (current.status === 'deleted') return this.applied(op, current.serverRev, false);
    const rev = current.serverRev + 1;
    await tx
      .update(attachments)
      .set({ status: 'deleted', deletedAt: sql`now()`, serverRev: rev })
      .where(eq(attachments.id, current.id));
    await this.change(tx, ctx, 'attachment', current.id, 'delete', rev);
    return this.applied(op, rev);
  }

  // ---------------------------------------------------------------- helpers

  private change(
    tx: Tx,
    ctx: OpContext,
    entityType: 'note' | 'collection' | 'tag' | 'attachment',
    id: string,
    op: 'upsert' | 'delete',
    rev: number,
  ): Promise<void> {
    return this.feed.append(tx, {
      userId: ctx.userId,
      entityType,
      entityId: id,
      entityKey: id,
      op,
      rev,
      deviceId: ctx.deviceId,
    });
  }
}
