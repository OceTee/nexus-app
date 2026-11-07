// REST note endpoints (TDD Section F, Notes). Every write is a synthesised
// sync op applied by the same engine as POST /v1/sync, so both paths behave
// identically; this class maps engine outcomes to HTTP errors.

import {
  diffSets,
  wordCount,
  decodeCursor,
  encodeCursor,
  LIMITS,
  type BacklinkDto,
  type ConflictDto,
  type NoteCreateInput,
  type NoteDto,
  type NoteListQuery,
  type NoteSummaryDto,
  type NoteUpdateInput,
  type NoteVersionDetailDto,
  type NoteVersionDto,
  type OutgoingLinkDto,
  type Paginated,
  type ResolveConflictInput,
  type SyncOp,
  type TrashedNoteDto,
} from '@nexus/shared';
import { and, desc, eq, exists, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { devices, notes, noteTags, noteVersions } from '../../db/schema';
import { withUser, type Tx } from '../../db/withUser';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  DuplicateError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import type { ApplyOutcome, ContentEngine, OpContext } from '../content/applyOps';
import { iso } from '../content/derive';
import { loadNote, tagIdsByNote, toNoteDto } from '../content/loaders';
import type { LinksService } from '../links/links.service';

// Cursors keep Postgres's own timestamp text (microseconds), so equal-millisecond rows are not skipped.
const PgTimestamp = z.string().min(10).max(40);
const ListCursor = z.object({ updatedAt: PgTimestamp, id: z.string() });
const VersionCursor = z.object({ createdAt: PgTimestamp, id: z.string() });

function parseCursor<S extends z.ZodType>(
  cursor: string | undefined,
  schema: S,
): z.output<S> | undefined {
  if (!cursor) return undefined;
  try {
    return decodeCursor(cursor, schema);
  } catch {
    throw new ValidationError([
      { path: ['cursor'], issue: 'invalid_cursor', message: 'Invalid cursor' },
    ]);
  }
}

/** Maps a rejected or conflicting engine outcome to the REST error. */
export function throwIfNotApplied(outcome: ApplyOutcome, entity = 'Note'): void {
  const { result } = outcome;
  if (result.status === 'conflict') {
    if (result.conflictVersionId) {
      throw new ConflictError({
        serverRev: result.serverRev!,
        conflictVersionId: result.conflictVersionId,
      });
    }
    throw new AppError(409, 'CONFLICT', 'The item changed on another device', {
      serverRev: result.serverRev,
    });
  }
  if (result.status === 'rejected') {
    const code = result.error?.code ?? 'BUSINESS_RULE';
    if (code === 'NOT_FOUND') throw new NotFoundError(entity);
    if (code === 'DUPLICATE') throw new AppError(409, 'DUPLICATE', result.error!.message);
    throw new BusinessRuleError(code, result.error?.message ?? 'Rejected');
  }
}

const op = <T extends SyncOp['type']>(
  type: T,
  fields: Omit<Extract<SyncOp, { type: T }>, 'opId' | 'createdAt' | 'type'>,
) =>
  ({ opId: uuidv7(), createdAt: new Date().toISOString(), type, ...fields }) as Extract<
    SyncOp,
    { type: T }
  >;

export class NotesService {
  constructor(
    private readonly db: Db,
    private readonly engine: ContentEngine,
    private readonly links: LinksService,
  ) {}

  private ctx(userId: string, deviceId: string): OpContext {
    return { userId, deviceId };
  }

  async list(userId: string, q: NoteListQuery): Promise<Paginated<NoteSummaryDto>> {
    const after = parseCursor(q.cursor, ListCursor);
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(notes)
        .where(
          and(
            isNull(notes.deletedAt),
            q.collectionId ? eq(notes.collectionId, q.collectionId) : undefined,
            q.pinned !== undefined ? eq(notes.isPinned, q.pinned) : undefined,
            q.tagId
              ? exists(
                  tx
                    .select({ one: sql`1` })
                    .from(noteTags)
                    .where(
                      and(
                        eq(noteTags.noteId, notes.id),
                        eq(noteTags.tagId, q.tagId),
                        isNull(noteTags.deletedAt),
                      ),
                    ),
                )
              : undefined,
            after
              ? or(
                  lt(notes.updatedAt, after.updatedAt),
                  and(eq(notes.updatedAt, after.updatedAt), lt(notes.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(notes.updatedAt), desc(notes.id))
        .limit(q.limit + 1);
      return this.page(tx, rows, q.limit, (r) => ({ updatedAt: r.updatedAt, id: r.id }));
    });
  }

  async trash(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Paginated<TrashedNoteDto>> {
    const after = parseCursor(cursor, ListCursor);
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(notes)
        .where(
          and(
            isNotNull(notes.deletedAt),
            after
              ? or(
                  lt(notes.deletedAt, after.updatedAt),
                  and(eq(notes.deletedAt, after.updatedAt), lt(notes.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(notes.deletedAt), desc(notes.id))
        .limit(limit + 1);
      const page = await this.page(tx, rows, limit, (r) => ({ updatedAt: r.deletedAt!, id: r.id }));
      return {
        ...page,
        items: page.items.map((n) => ({
          ...n,
          deletedAt: n.deletedAt!,
          purgeAt: new Date(
            Date.parse(n.deletedAt!) + LIMITS.trashRetentionDays * 86_400_000,
          ).toISOString(),
        })),
      };
    });
  }

  /** Builds a summary page; timestamps in cursors keep microseconds by reading them as text. */
  private async page(
    tx: Tx,
    rows: (typeof notes.$inferSelect)[],
    limit: number,
    key: (r: typeof notes.$inferSelect) => { updatedAt: string; id: string },
  ): Promise<Paginated<NoteSummaryDto>> {
    const pageRows = rows.slice(0, limit);
    const tagMap = await tagIdsByNote(
      tx,
      pageRows.map((r) => r.id),
    );
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((r) => {
        const { bodyMd: _bodyMd, ...summary } = toNoteDto(r, tagMap.get(r.id) ?? []);
        return summary;
      }),
      hasMore: rows.length > limit,
      nextCursor: rows.length > limit && last ? encodeCursor(key(last)) : null,
    };
  }

  async get(userId: string, noteId: string): Promise<NoteDto> {
    return withUser(this.db, userId, async (tx) => {
      const note = await loadNote(tx, noteId);
      if (!note) throw new NotFoundError('Note');
      return note;
    });
  }

  async create(userId: string, deviceId: string, input: NoteCreateInput): Promise<NoteDto> {
    return withUser(this.db, userId, async (tx) => {
      const [existing] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(eq(notes.id, input.id));
      if (existing) throw new DuplicateError('note', input.id);
      const { id, ...payload } = input;
      const outcome = await this.engine.apply(
        tx,
        this.ctx(userId, deviceId),
        op('note.upsert', { entityId: id, baseRev: 0, payload }),
      );
      throwIfNotApplied(outcome);
      return (await loadNote(tx, id))!;
    });
  }

  /** PATCH: merges the given fields onto the note at `baseRev`; tag ids become set-merge ops. */
  async update(
    userId: string,
    deviceId: string,
    noteId: string,
    input: NoteUpdateInput,
  ): Promise<NoteDto> {
    return this.committing(userId, async (tx) => {
      const current = await loadNote(tx, noteId);
      if (!current || current.deletedAt) throw new NotFoundError('Note');
      const ctx = this.ctx(userId, deviceId);
      const outcome = await this.engine.apply(
        tx,
        ctx,
        op('note.upsert', {
          entityId: noteId,
          baseRev: input.baseRev,
          payload: {
            title: input.title ?? current.title,
            bodyMd: input.bodyMd ?? current.bodyMd,
            collectionId:
              input.collectionId === undefined ? current.collectionId : input.collectionId,
            isPinned: input.isPinned ?? current.isPinned,
            tagIds: [],
          },
        }),
      );
      if (outcome.result.status === 'conflict') return { conflict: outcome };
      throwIfNotApplied(outcome);
      if (input.tagIds) await this.setTags(tx, ctx, noteId, current.tagIds, input.tagIds);
      return { value: (await loadNote(tx, noteId))! };
    });
  }

  /**
   * Runs a write and commits a conflict before reporting it: the client copy
   * must survive as a conflict version, so the 409 is thrown after commit.
   */
  private async committing<T>(
    userId: string,
    fn: (tx: Tx) => Promise<{ value: T } | { conflict: ApplyOutcome }>,
  ): Promise<T> {
    const out = await withUser(this.db, userId, fn);
    if ('conflict' in out) {
      throwIfNotApplied(out.conflict);
      throw new Error('unreachable');
    }
    return out.value;
  }

  /** Delete wins (T-57): moves the note to Trash; the base revision is not required to match. */
  async remove(userId: string, deviceId: string, noteId: string, baseRev: number): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      throwIfNotApplied(
        await this.engine.apply(
          tx,
          this.ctx(userId, deviceId),
          op('note.delete', { entityId: noteId, baseRev }),
        ),
      );
    });
  }

  async restore(userId: string, deviceId: string, noteId: string): Promise<NoteDto> {
    return withUser(this.db, userId, async (tx) => {
      await this.engine
        .restoreNote(tx, this.ctx(userId, deviceId), noteId)
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === 'NOT_FOUND') throw new NotFoundError('Note');
          throw err;
        });
      return (await loadNote(tx, noteId))!;
    });
  }

  // ---------------------------------------------------------------- versions

  async versions(
    userId: string,
    noteId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Paginated<NoteVersionDto>> {
    const after = parseCursor(cursor, VersionCursor);
    return withUser(this.db, userId, async (tx) => {
      await this.assertNote(tx, noteId);
      const rows = await tx
        .select({ v: noteVersions, deviceName: devices.name })
        .from(noteVersions)
        .leftJoin(devices, eq(devices.id, noteVersions.deviceId))
        .where(
          and(
            eq(noteVersions.noteId, noteId),
            after
              ? or(
                  lt(noteVersions.createdAt, after.createdAt),
                  and(eq(noteVersions.createdAt, after.createdAt), lt(noteVersions.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(noteVersions.createdAt), desc(noteVersions.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(({ v, deviceName }) => this.versionDto(v, deviceName)),
        hasMore: rows.length > limit,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ createdAt: last.v.createdAt, id: last.v.id })
            : null,
      };
    });
  }

  private versionDto(
    v: typeof noteVersions.$inferSelect,
    deviceName: string | null,
  ): NoteVersionDto {
    return {
      id: v.id,
      rev: v.rev,
      baseRev: v.baseRev ?? 0,
      conflict: v.conflict,
      resolvedAt: iso(v.resolvedAt),
      deviceName,
      wordCount: wordCount(v.bodyMd),
      createdAt: iso(v.createdAt),
    };
  }

  async version(userId: string, noteId: string, versionId: string): Promise<NoteVersionDetailDto> {
    return withUser(this.db, userId, async (tx) => {
      const v = await this.findVersion(tx, noteId, versionId);
      return { ...this.versionDto(v.v, v.deviceName), title: v.v.title, bodyMd: v.v.bodyMd };
    });
  }

  /** Restores a version's content as a new revision. */
  async restoreVersion(
    userId: string,
    deviceId: string,
    noteId: string,
    versionId: string,
    baseRev: number,
  ): Promise<NoteDto> {
    return this.committing(userId, async (tx) => {
      const { v } = await this.findVersion(tx, noteId, versionId);
      const current = (await loadNote(tx, noteId))!;
      const outcome = await this.engine.apply(
        tx,
        this.ctx(userId, deviceId),
        op('note.upsert', {
          entityId: noteId,
          baseRev,
          payload: {
            title: v.title,
            bodyMd: v.bodyMd,
            collectionId: current.collectionId,
            isPinned: current.isPinned,
            tagIds: [],
          },
        }),
      );
      if (outcome.result.status === 'conflict') return { conflict: outcome };
      throwIfNotApplied(outcome);
      return { value: (await loadNote(tx, noteId))! };
    });
  }

  private async findVersion(tx: Tx, noteId: string, versionId: string) {
    const [row] = await tx
      .select({ v: noteVersions, deviceName: devices.name })
      .from(noteVersions)
      .leftJoin(devices, eq(devices.id, noteVersions.deviceId))
      .where(and(eq(noteVersions.id, versionId), eq(noteVersions.noteId, noteId)));
    if (!row) throw new NotFoundError('Version');
    return row;
  }

  // --------------------------------------------------------------- conflicts

  async conflicts(userId: string, noteId: string): Promise<{ items: ConflictDto[] }> {
    return withUser(this.db, userId, async (tx) => {
      await this.assertNote(tx, noteId);
      const rows = await tx
        .select()
        .from(noteVersions)
        .where(
          and(
            eq(noteVersions.noteId, noteId),
            eq(noteVersions.conflict, true),
            isNull(noteVersions.resolvedAt),
          ),
        )
        .orderBy(desc(noteVersions.createdAt));
      return {
        items: rows.map((v) => ({
          noteId,
          versionId: v.id,
          serverRev: v.rev,
          deviceId: v.deviceId,
          createdAt: iso(v.createdAt),
        })),
      };
    });
  }

  /**
   * keep_server: discard the conflict copy; keep_mine / merged: write it as a new
   * revision. Resolves every open conflict on the note.
   */
  async resolveConflict(
    userId: string,
    deviceId: string,
    noteId: string,
    versionId: string,
    input: ResolveConflictInput,
  ): Promise<NoteDto> {
    return withUser(this.db, userId, async (tx) => {
      const { v } = await this.findVersion(tx, noteId, versionId);
      if (!v.conflict || v.resolvedAt) throw new NotFoundError('Open conflict');
      const current = (await loadNote(tx, noteId))!;
      if (input.baseRev !== current.serverRev) {
        throw new AppError(409, 'CONFLICT', 'The note changed again; review the latest version', {
          serverRev: current.serverRev,
        });
      }
      if (input.strategy !== 'keep_server') {
        const title = input.strategy === 'merged' ? (input.title ?? current.title) : v.title;
        const bodyMd = input.strategy === 'merged' ? input.bodyMd! : v.bodyMd;
        throwIfNotApplied(
          await this.engine.apply(
            tx,
            this.ctx(userId, deviceId),
            op('note.upsert', {
              entityId: noteId,
              baseRev: input.baseRev,
              payload: {
                title,
                bodyMd,
                collectionId: current.collectionId,
                isPinned: current.isPinned,
                tagIds: [],
              },
            }),
          ),
        );
      }
      // The choice settles the note, so every open conflict copy of it is
      // resolved, not only this one (stacked edits can leave several).
      await tx
        .update(noteVersions)
        .set({ resolvedAt: sql`now()` })
        .where(
          and(
            eq(noteVersions.noteId, noteId),
            eq(noteVersions.conflict, true),
            isNull(noteVersions.resolvedAt),
          ),
        );
      return (await loadNote(tx, noteId))!;
    });
  }

  // ------------------------------------------------------------ links, tags

  async backlinks(userId: string, noteId: string): Promise<{ items: BacklinkDto[] }> {
    return withUser(this.db, userId, async (tx) => {
      await this.assertNote(tx, noteId);
      return { items: await this.links.backlinks(tx, noteId) };
    });
  }

  async outgoing(userId: string, noteId: string): Promise<{ items: OutgoingLinkDto[] }> {
    return withUser(this.db, userId, async (tx) => {
      const note = await loadNote(tx, noteId);
      if (!note) throw new NotFoundError('Note');
      return { items: await this.links.outgoing(tx, noteId, note.bodyMd) };
    });
  }

  async replaceTags(
    userId: string,
    deviceId: string,
    noteId: string,
    tagIds: string[],
  ): Promise<NoteDto> {
    return withUser(this.db, userId, async (tx) => {
      const current = await loadNote(tx, noteId);
      if (!current) throw new NotFoundError('Note');
      await this.setTags(tx, this.ctx(userId, deviceId), noteId, current.tagIds, tagIds);
      return (await loadNote(tx, noteId))!;
    });
  }

  async addTag(userId: string, deviceId: string, noteId: string, tagId: string): Promise<NoteDto> {
    return this.membership(userId, deviceId, noteId, tagId, 'note_tag.add');
  }

  async removeTag(
    userId: string,
    deviceId: string,
    noteId: string,
    tagId: string,
  ): Promise<NoteDto> {
    return this.membership(userId, deviceId, noteId, tagId, 'note_tag.remove');
  }

  private async membership(
    userId: string,
    deviceId: string,
    noteId: string,
    tagId: string,
    type: 'note_tag.add' | 'note_tag.remove',
  ): Promise<NoteDto> {
    return withUser(this.db, userId, async (tx) => {
      throwIfNotApplied(
        await this.engine.apply(tx, this.ctx(userId, deviceId), op(type, { noteId, tagId })),
      );
      return (await loadNote(tx, noteId))!;
    });
  }

  private async setTags(
    tx: Tx,
    ctx: OpContext,
    noteId: string,
    before: string[],
    after: string[],
  ): Promise<void> {
    const { added, removed } = diffSets(before, after);
    for (const tagId of added)
      throwIfNotApplied(
        await this.engine.apply(tx, ctx, op('note_tag.add', { noteId, tagId })),
        'Tag',
      );
    for (const tagId of removed)
      throwIfNotApplied(
        await this.engine.apply(tx, ctx, op('note_tag.remove', { noteId, tagId })),
        'Tag',
      );
  }

  private async assertNote(tx: Tx, noteId: string): Promise<void> {
    const [row] = await tx.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId));
    if (!row) throw new NotFoundError('Note');
  }
}
