// Server-side exports (post-MVP, behind FEATURE_SERVER_EXPORTS). MVP exports
// are generated on the device; this module produces the same formats in a
// background job, stores them under the user's R2 prefix for 7 days.

import type { ExportCreateInput, ExportJobDto } from '@nexus/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { zipSync } from 'fflate';
import type { Db } from '../../db/client';
import { attachments, exportJobs, noteLinks, notes, noteTags, noteVersions } from '../../db/schema';
import { withUser, type Tx } from '../../db/withUser';
import type { Storage } from '../../integrations/r2';
import type { JobQueue } from '../../jobs/queue';
import { AppError, NotFoundError } from '../../lib/errors';
import { iso } from '../content/derive';
import { loadCollections, loadNotes, loadTags } from '../content/loaders';
import { markdownBundleFiles, type ExportNote } from './bundles';

export const EXPORT_TTL_DAYS = 7;

function toDto(row: typeof exportJobs.$inferSelect): ExportJobDto {
  return {
    id: row.id,
    format: row.format,
    status: row.status,
    createdAt: iso(row.createdAt),
    expiresAt: iso(row.expiresAt),
  };
}

export class ExportsService {
  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
    private readonly queue: JobQueue,
    private readonly enabled: boolean,
  ) {}

  async create(userId: string, input: ExportCreateInput): Promise<ExportJobDto> {
    if (!this.enabled) {
      throw new AppError(
        503,
        'FEATURE_DISABLED',
        'Server-side export is not enabled; export from the app instead',
      );
    }
    const row = await withUser(this.db, userId, async (tx) => {
      if (input.collectionId) {
        const found = await loadCollections(tx, [input.collectionId]);
        if (found.size === 0) throw new NotFoundError('Collection');
      }
      const [inserted] = await tx
        .insert(exportJobs)
        .values({ userId, format: input.format, scopeCollectionId: input.collectionId ?? null })
        .returning();
      return inserted!;
    });
    await this.queue.send('exports.generate', { exportId: row.id, userId });
    return toDto(row);
  }

  async list(userId: string): Promise<{ items: ExportJobDto[] }> {
    const rows = await withUser(this.db, userId, (tx) =>
      tx.select().from(exportJobs).orderBy(desc(exportJobs.createdAt)).limit(50),
    );
    return { items: rows.map(toDto) };
  }

  async get(userId: string, id: string): Promise<ExportJobDto> {
    return toDto(await this.find(userId, id));
  }

  async downloadUrl(userId: string, id: string): Promise<{ url: string; expiresAt: string }> {
    const row = await this.find(userId, id);
    if (row.status === 'expired') throw new AppError(410, 'EXPIRED', 'This export has expired');
    if (row.status !== 'ready' || !row.storageKey) {
      throw new AppError(
        409,
        'NOT_READY',
        row.status === 'failed' ? 'This export failed' : 'This export is not ready yet',
      );
    }
    return this.storage.presignGet(row.storageKey, {
      downloadAs: `nexus-export-${row.createdAt.slice(0, 10)}.${row.format === 'json' ? 'json' : 'zip'}`,
    });
  }

  private async find(userId: string, id: string) {
    const [row] = await withUser(this.db, userId, (tx) =>
      tx.select().from(exportJobs).where(eq(exportJobs.id, id)),
    );
    if (!row) throw new NotFoundError('Export');
    return row;
  }

  /** Job body for `exports.generate`. Idempotent: a finished job is left alone. */
  async generate(userId: string, exportId: string): Promise<void> {
    const job = await this.find(userId, exportId);
    if (job.status !== 'queued' && job.status !== 'running') return;
    await withUser(this.db, userId, (tx) =>
      tx.update(exportJobs).set({ status: 'running' }).where(eq(exportJobs.id, exportId)),
    );
    try {
      const { body, contentType, ext } = await withUser(this.db, userId, (tx) =>
        this.build(tx, job.format, job.scopeCollectionId),
      );
      const key = `u/${userId}/exports/${exportId}.${ext}`;
      await this.storage.put(key, body, contentType);
      await withUser(this.db, userId, (tx) =>
        tx
          .update(exportJobs)
          .set({
            status: 'ready',
            storageKey: key,
            sizeBytes: body.byteLength,
            completedAt: sql`now()`,
            expiresAt: sql`now() + make_interval(days => ${EXPORT_TTL_DAYS})`,
          })
          .where(eq(exportJobs.id, exportId)),
      );
    } catch (err) {
      await withUser(this.db, userId, (tx) =>
        tx
          .update(exportJobs)
          .set({
            status: 'failed',
            error: (err as Error).message.slice(0, 500),
            completedAt: sql`now()`,
          })
          .where(eq(exportJobs.id, exportId)),
      );
      throw err;
    }
  }

  private async build(tx: Tx, format: 'markdown_zip' | 'json', scope: string | null) {
    const scopeIds = scope ? await this.subtree(tx, scope) : null;
    const noteRows = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(isNull(notes.deletedAt), scopeIds ? inArray(notes.collectionId, scopeIds) : undefined),
      );
    const ids = noteRows.map((n) => n.id);
    const noteMap = await loadNotes(tx, ids);
    const collectionMap = await loadCollections(tx);
    const tagMap = await loadTags(tx);
    const links = ids.length
      ? await tx.select().from(noteLinks).where(inArray(noteLinks.sourceNoteId, ids))
      : [];
    const titleById = new Map([...noteMap.values()].map((n) => [n.id, n.title]));

    if (format === 'json') {
      const versions = ids.length
        ? await tx.select().from(noteVersions).where(inArray(noteVersions.noteId, ids))
        : [];
      const memberships = ids.length
        ? await tx
            .select()
            .from(noteTags)
            .where(and(inArray(noteTags.noteId, ids), isNull(noteTags.deletedAt)))
        : [];
      const files = ids.length
        ? await tx
            .select()
            .from(attachments)
            .where(and(inArray(attachments.noteId, ids), eq(attachments.status, 'uploaded')))
        : [];
      const doc = {
        format: 'nexus-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: [...noteMap.values()],
        collections: [...collectionMap.values()],
        tags: [...tagMap.values()],
        noteTags: memberships.map((m) => ({
          noteId: m.noteId,
          tagId: m.tagId,
          createdAt: iso(m.createdAt),
        })),
        links: links.map((l) => ({
          sourceNoteId: l.sourceNoteId,
          targetTitleNorm: l.targetTitleNorm,
          targetNoteId: l.targetNoteId,
        })),
        versions: versions.map((v) => ({
          ...v,
          createdAt: iso(v.createdAt),
          resolvedAt: iso(v.resolvedAt),
        })),
        attachments: files.map((a) => ({
          id: a.id,
          noteId: a.noteId,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          sha256: a.sha256,
        })),
      };
      return {
        body: new TextEncoder().encode(JSON.stringify(doc, null, 2)),
        contentType: 'application/json',
        ext: 'json',
      };
    }

    const exportNotes: ExportNote[] = [...noteMap.values()].map((n) => ({
      id: n.id,
      title: n.title,
      bodyMd: n.bodyMd,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      collection: n.collectionId ? (collectionMap.get(n.collectionId)?.name ?? null) : null,
      tags: n.tagIds.map((t) => tagMap.get(t)?.name).filter((t): t is string => Boolean(t)),
      links: links
        .filter((l) => l.sourceNoteId === n.id)
        .map((l) =>
          l.targetNoteId ? (titleById.get(l.targetNoteId) ?? l.targetTitleNorm) : l.targetTitleNorm,
        ),
    }));
    const files = ids.length
      ? await tx
          .select()
          .from(attachments)
          .where(and(inArray(attachments.noteId, ids), eq(attachments.status, 'uploaded')))
      : [];
    const withBytes = await Promise.all(
      files.map(async (a) => ({
        id: a.id,
        noteId: a.noteId,
        filename: a.filename,
        mimeType: a.mimeType,
        bytes: await this.storage.getBytes(a.storageKey),
      })),
    );
    const zip = zipSync(markdownBundleFiles(exportNotes, withBytes), { level: 6 });
    return { body: zip, contentType: 'application/zip', ext: 'zip' };
  }

  private async subtree(tx: Tx, root: string): Promise<string[]> {
    const result = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE sub AS (
        SELECT id FROM collections WHERE id = ${root} AND deleted_at IS NULL
        UNION ALL
        SELECT c.id FROM collections c JOIN sub ON c.parent_id = sub.id WHERE c.deleted_at IS NULL
      ) SELECT id FROM sub`);
    return result.rows.map((r) => r.id);
  }
}
