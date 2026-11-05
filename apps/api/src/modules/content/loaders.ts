// Batch loaders that turn rows into the wire DTOs from @nexus/shared.
// All run inside a user-scoped transaction, so RLS limits them to the caller.

import type { AttachmentDto, CollectionDto, NoteDto, TagDto } from '@nexus/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { attachments, collections, notes, noteTags, tags } from '../../db/schema';
import type { Tx } from '../../db/withUser';
import { iso } from './derive';

type NoteRow = typeof notes.$inferSelect;

export function toNoteDto(row: NoteRow, tagIds: string[]): NoteDto {
  return {
    id: row.id,
    title: row.title,
    bodyMd: row.bodyMd,
    excerpt: row.excerpt,
    collectionId: row.collectionId,
    isPinned: row.isPinned,
    wordCount: row.wordCount,
    serverRev: row.serverRev,
    tagIds,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: iso(row.deletedAt),
  };
}

/** Live tag ids per note. */
export async function tagIdsByNote(tx: Tx, noteIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(noteIds.map((id) => [id, []]));
  if (noteIds.length === 0) return map;
  const rows = await tx
    .select({ noteId: noteTags.noteId, tagId: noteTags.tagId })
    .from(noteTags)
    .where(and(inArray(noteTags.noteId, noteIds), isNull(noteTags.deletedAt)))
    .orderBy(noteTags.createdAt);
  for (const r of rows) map.get(r.noteId)?.push(r.tagId);
  return map;
}

export async function loadNotes(tx: Tx, ids: string[]): Promise<Map<string, NoteDto>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select().from(notes).where(inArray(notes.id, ids));
  const tagMap = await tagIdsByNote(
    tx,
    rows.map((r) => r.id),
  );
  return new Map(rows.map((r) => [r.id, toNoteDto(r, tagMap.get(r.id) ?? [])]));
}

export async function loadNote(tx: Tx, id: string): Promise<NoteDto | null> {
  return (await loadNotes(tx, [id])).get(id) ?? null;
}

export async function loadCollections(tx: Tx, ids?: string[]): Promise<Map<string, CollectionDto>> {
  if (ids && ids.length === 0) return new Map();
  // Qualified by name: Drizzle drops the table prefix in single-table selects.
  const noteCount = sql<number>`(SELECT count(*)::int FROM notes n
    WHERE n.collection_id = "collections"."id" AND n.deleted_at IS NULL)`;
  const rows = await tx
    .select({ c: collections, noteCount })
    .from(collections)
    .where(ids ? inArray(collections.id, ids) : isNull(collections.deletedAt))
    .orderBy(collections.sortOrder, collections.name);
  return new Map(
    rows.map(({ c, noteCount }) => [
      c.id,
      {
        id: c.id,
        parentId: c.parentId,
        name: c.name,
        icon: c.icon,
        sortOrder: c.sortOrder,
        noteCount: Number(noteCount),
        serverRev: c.serverRev,
        createdAt: iso(c.createdAt),
        updatedAt: iso(c.updatedAt),
      },
    ]),
  );
}

export async function loadTags(tx: Tx, ids?: string[]): Promise<Map<string, TagDto>> {
  if (ids && ids.length === 0) return new Map();
  const noteCount = sql<number>`(SELECT count(*)::int FROM note_tags nt
    JOIN notes n ON n.id = nt.note_id
    WHERE nt.tag_id = "tags"."id" AND nt.deleted_at IS NULL AND n.deleted_at IS NULL)`;
  const rows = await tx
    .select({ t: tags, noteCount })
    .from(tags)
    .where(ids ? inArray(tags.id, ids) : isNull(tags.deletedAt))
    .orderBy(tags.nameNorm);
  return new Map(
    rows.map(({ t, noteCount }) => [
      t.id,
      {
        id: t.id,
        name: t.name,
        colour: t.colour,
        noteCount: Number(noteCount),
        serverRev: t.serverRev,
      },
    ]),
  );
}

export function toAttachmentDto(a: typeof attachments.$inferSelect): AttachmentDto {
  return {
    id: a.id,
    noteId: a.noteId,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    status: a.status,
    width: a.width,
    height: a.height,
    serverRev: a.serverRev,
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  };
}

export async function loadAttachments(tx: Tx, ids: string[]): Promise<Map<string, AttachmentDto>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select().from(attachments).where(inArray(attachments.id, ids));
  return new Map(rows.map((a) => [a.id, toAttachmentDto(a)]));
}

/** Membership row for `note_tag` changes. */
export async function loadMembership(tx: Tx, noteId: string, tagId: string) {
  const [row] = await tx
    .select()
    .from(noteTags)
    .where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId)));
  return row ?? null;
}
