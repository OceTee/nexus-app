// Attachments (TDD Sections D, F and H). Devices upload directly to R2 with a
// presigned PUT; `complete` verifies the object exists with the declared size
// and that its first bytes match the declared type before marking it uploaded.

import {
  LIMITS,
  decodeCursor,
  encodeCursor,
  type AttachmentCreateInput,
  type AttachmentCreatedDto,
  type AttachmentDto,
  type Paginated,
  type SyncOp,
} from '@nexus/shared';
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { attachments, notes } from '../../db/schema';
import { withUser } from '../../db/withUser';
import type { Storage } from '../../integrations/r2';
import { attachmentKey } from '../../integrations/r2';
import {
  AppError,
  BusinessRuleError,
  DuplicateError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import type { ContentEngine } from '../content/applyOps';
import { toAttachmentDto } from '../content/loaders';
import type { ChangeFeed } from '../sync/changeFeed';
import { throwIfNotApplied } from '../notes/notes.service';
import { matchesDeclaredType, SNIFF_BYTES } from './magic';

const ListCursor = z.object({ createdAt: z.string().min(10).max(40), id: z.string() });

export class AttachmentsService {
  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
    private readonly engine: ContentEngine,
    private readonly feed: ChangeFeed,
  ) {}

  async list(
    userId: string,
    noteId: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<Paginated<AttachmentDto>> {
    let after: z.infer<typeof ListCursor> | undefined;
    if (cursor) {
      try {
        after = decodeCursor(cursor, ListCursor);
      } catch {
        throw new ValidationError([
          { path: ['cursor'], issue: 'invalid_cursor', message: 'Invalid cursor' },
        ]);
      }
    }
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(attachments)
        .where(
          and(
            ne(attachments.status, 'deleted'),
            noteId ? eq(attachments.noteId, noteId) : undefined,
            after
              ? or(
                  lt(attachments.createdAt, after.createdAt),
                  and(eq(attachments.createdAt, after.createdAt), lt(attachments.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(attachments.createdAt), desc(attachments.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toAttachmentDto),
        hasMore: rows.length > limit,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    });
  }

  /** Creates the pending row and returns a 15-minute presigned PUT. */
  async create(userId: string, input: AttachmentCreateInput): Promise<AttachmentCreatedDto> {
    const storageKey = attachmentKey(userId, input.id, input.filename);
    const row = await withUser(this.db, userId, async (tx) => {
      const [note] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, input.noteId), isNull(notes.deletedAt)));
      if (!note) throw new NotFoundError('Note');

      // BR-16: uploaded plus pending bytes stay within the quota.
      const [used] = await tx
        .select({ bytes: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)` })
        .from(attachments)
        .where(inArray(attachments.status, ['pending', 'uploaded']));
      if (Number(used?.bytes ?? 0) + input.sizeBytes > LIMITS.attachmentQuotaBytes) {
        throw new BusinessRuleError('QUOTA_EXCEEDED', 'Attachment storage quota exceeded');
      }

      try {
        const [inserted] = await tx
          .insert(attachments)
          .values({
            id: input.id,
            userId,
            noteId: input.noteId,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
            width: input.width ?? null,
            height: input.height ?? null,
            storageKey,
            status: 'pending',
          })
          .returning();
        return inserted!;
      } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } };
        if (e.code === '23505' || e.cause?.code === '23505')
          throw new DuplicateError('attachment', input.id);
        throw err;
      }
    });

    const upload = await this.storage.presignPut(storageKey, input.mimeType, input.sizeBytes);
    return { attachment: toAttachmentDto(row), upload: { ...upload, method: 'PUT' } };
  }

  /**
   * BR-14: uploaded only after HEAD confirms the object and its size, and the
   * first bytes match the declared type. A mismatch deletes the object.
   */
  async complete(userId: string, deviceId: string, id: string): Promise<AttachmentDto> {
    const row = await this.find(userId, id);
    if (row.status === 'uploaded') return toAttachmentDto(row);
    if (row.status === 'deleted') throw new NotFoundError('Attachment');

    const info = await this.storage.head(row.storageKey);
    if (!info) throw new AppError(409, 'UPLOAD_INCOMPLETE', 'The file has not been uploaded yet');

    const sizeOk = info.size === row.sizeBytes;
    const typeOk =
      sizeOk &&
      matchesDeclaredType(await this.storage.readStart(row.storageKey, SNIFF_BYTES), row.mimeType);
    if (!sizeOk || !typeOk) {
      await this.storage.delete(row.storageKey);
      await withUser(this.db, userId, (tx) =>
        tx
          .update(attachments)
          .set({ status: 'deleted', deletedAt: sql`now()` })
          .where(eq(attachments.id, id)),
      );
      throw sizeOk
        ? new BusinessRuleError(
            'TYPE_MISMATCH',
            'The file content does not match its declared type',
          )
        : new BusinessRuleError(
            'TYPE_MISMATCH',
            'The uploaded size does not match the declared size',
          );
    }

    return withUser(this.db, userId, async (tx) => {
      const [updated] = await tx
        .update(attachments)
        .set({ status: 'uploaded', serverRev: sql`${attachments.serverRev} + 1` })
        .where(and(eq(attachments.id, id), eq(attachments.status, 'pending')))
        .returning();
      if (!updated)
        return toAttachmentDto(
          (await tx.select().from(attachments).where(eq(attachments.id, id)))[0]!,
        );
      await this.feed.append(tx, {
        userId,
        entityType: 'attachment',
        entityId: id,
        entityKey: id,
        op: 'upsert',
        rev: updated.serverRev,
        deviceId,
      });
      return toAttachmentDto(updated);
    });
  }

  async get(userId: string, id: string): Promise<AttachmentDto> {
    const row = await this.find(userId, id);
    if (row.status === 'deleted') throw new NotFoundError('Attachment');
    return toAttachmentDto(row);
  }

  /** 1-hour presigned GET; PDFs download with Content-Disposition: attachment. */
  async downloadUrl(userId: string, id: string): Promise<{ url: string; expiresAt: string }> {
    const row = await this.find(userId, id);
    if (row.status !== 'uploaded')
      throw new AppError(409, 'NOT_READY', 'The attachment is not uploaded yet');
    return this.storage.presignGet(
      row.storageKey,
      row.mimeType === 'application/pdf' ? { downloadAs: row.filename } : {},
    );
  }

  /** Marks the attachment deleted; the orphan sweep removes the object within 24 hours. */
  async remove(userId: string, deviceId: string, id: string): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      const [row] = await tx.select().from(attachments).where(eq(attachments.id, id));
      if (!row || row.status === 'deleted') throw new NotFoundError('Attachment');
      if (row.status === 'pending') {
        await tx
          .update(attachments)
          .set({ status: 'deleted', deletedAt: sql`now()` })
          .where(eq(attachments.id, id));
        return;
      }
      const op: SyncOp = {
        opId: uuidv7(),
        createdAt: new Date().toISOString(),
        type: 'attachment.delete',
        entityId: id,
        baseRev: row.serverRev,
      };
      throwIfNotApplied(await this.engine.apply(tx, { userId, deviceId }, op), 'Attachment');
    });
  }

  private async find(userId: string, id: string) {
    const [row] = await withUser(this.db, userId, (tx) =>
      tx.select().from(attachments).where(eq(attachments.id, id)),
    );
    if (!row) throw new NotFoundError('Attachment');
    return row;
  }
}
