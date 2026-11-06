// Applying a sync response to the local database (TDD Section G, Sync engine
// algorithm). Everything here runs inside the engine's single exclusive
// transaction together with the new cursor, so a crash cannot leave the
// cursor ahead of the data (T-56).

import {
  excerpt,
  normaliseTitle,
  stripMarkdown,
  wordCount,
  type AttachmentDto,
  type CollectionDto,
  type ConflictDto,
  type NoteDto,
  type OpResult,
  type SyncChange,
  type TagDto,
} from '@nexus/shared';
import type { SqlDb } from '@/infra/sql';
import type { Table } from '../events';
import { rewriteLinks } from '../repos/notes';
import type { NoteTagRow, OutboxRow } from '../rows';

const now = () => new Date().toISOString();

/** Table holding each entity type, for dirty checks and revision updates. */
const TABLE = {
  note: 'notes',
  collection: 'collections',
  tag: 'tags',
  attachment: 'attachments',
} as const;

export interface ApplyReport {
  touched: Set<Table>;
  errors: { code: string; message: string; entity: string }[];
}

const report = (): ApplyReport => ({ touched: new Set(), errors: [] });

async function hasPending(tx: SqlDb, entityType: string, entityId: string): Promise<boolean> {
  const r = await tx.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM outbox WHERE entity_type = ? AND entity_id = ? AND status != 'failed'`,
    [entityType, entityId],
  );
  return Number(r?.n ?? 0) > 0;
}

/**
 * Applies per-op results: records server revisions, clears dirty flags when
 * nothing else is queued for the entity, keeps the losing copy of a conflict
 * and drops acknowledged ops from the outbox.
 */
export async function applyResults(tx: SqlDb, results: OpResult[]): Promise<ApplyReport> {
  const out = report();
  if (results.length === 0) return out;
  const rows = await tx.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox WHERE op_id IN (${results.map(() => '?').join(',')})`,
    results.map((r) => r.opId),
  );
  const byOp = new Map(rows.map((r) => [r.op_id, r]));
  // Acknowledged ops leave the outbox first, so "still pending" below means a newer local edit.
  await tx.runAsync(
    `DELETE FROM outbox WHERE op_id IN (${results.map(() => '?').join(',')})`,
    results.map((r) => r.opId),
  );
  out.touched.add('outbox');

  for (const res of results) {
    const op = byOp.get(res.opId);
    if (!op) continue;
    const pending = await hasPending(tx, op.entity_type, op.entity_id);

    if (op.entity_type === 'note_tag') {
      const [noteId, tagId] = op.entity_id.split(':');
      if (!pending) {
        await tx.runAsync(`UPDATE note_tags SET dirty = 0 WHERE note_id = ? AND tag_id = ?`, [
          noteId ?? '',
          tagId ?? '',
        ]);
      }
      out.touched.add('note_tags');
    } else {
      const table = TABLE[op.entity_type as keyof typeof TABLE];
      if (res.serverRev !== undefined && table) {
        await tx.runAsync(`UPDATE ${table} SET server_rev = ? WHERE id = ?`, [
          res.serverRev,
          op.entity_id,
        ]);
        // A newer queued edit was based on the old revision; it is now based on this one.
        await tx.runAsync(
          `UPDATE outbox SET base_rev = ? WHERE entity_type = ? AND entity_id = ? AND status = 'pending'`,
          [res.serverRev, op.entity_type, op.entity_id],
        );
      }
      if (table && !pending) {
        await tx.runAsync(`UPDATE ${table} SET dirty = 0 WHERE id = ?`, [op.entity_id]);
      }
      if (table) out.touched.add(table);
    }

    if (res.status === 'conflict' && op.entity_type === 'note' && res.conflictVersionId) {
      // Keep this device's losing copy for the conflict screen (S-13).
      const payload = JSON.parse(op.payload) as { title?: string; bodyMd?: string };
      await tx.runAsync(
        `INSERT INTO note_versions_local (id, note_id, rev, base_rev, title, body_md, conflict, source, created_at)
         VALUES (?, ?, (SELECT local_rev FROM notes WHERE id = ?), ?, ?, ?, 1, 'conflict', ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          res.conflictVersionId,
          op.entity_id,
          op.entity_id,
          op.base_rev,
          payload.title ?? '',
          payload.bodyMd ?? '',
          op.created_at,
        ],
      );
      // The server copy wins locally; the next change for this note replaces the row.
      if (!pending) await tx.runAsync(`UPDATE notes SET dirty = 0 WHERE id = ?`, [op.entity_id]);
      out.touched.add('note_versions_local');
    }

    if (res.status === 'rejected') {
      const code = res.error?.code ?? 'REJECTED';
      out.errors.push({
        code,
        message: res.error?.message ?? 'The server rejected a change',
        entity: `${op.entity_type}.${op.op}`,
      });
      if (op.entity_type === 'note' && code === 'NOT_FOUND') {
        // Purged on another device: the local copy goes to Trash.
        await tx.runAsync(
          `UPDATE notes SET deleted_at = coalesce(deleted_at, ?), dirty = 0 WHERE id = ?`,
          [now(), op.entity_id],
        );
      }
    }
  }
  return out;
}

/** Stores conflicts the server reported so the banner and S-13 can show them. */
export async function storeConflicts(tx: SqlDb, conflicts: ConflictDto[]): Promise<ApplyReport> {
  const out = report();
  for (const c of conflicts) {
    await tx.runAsync(
      `INSERT INTO conflicts (id, note_id, version_id, server_rev, device_name, created_at)
       VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT(id) DO NOTHING`,
      [c.versionId, c.noteId, c.versionId, c.serverRev, c.createdAt],
    );
    out.touched.add('conflicts');
  }
  return out;
}

/**
 * Applies the change feed. Rows with unsent local edits (dirty) are skipped:
 * the local op carries its base revision and the server decides. Tag
 * memberships merge as sets instead.
 */
export async function applyChanges(tx: SqlDb, changes: SyncChange[]): Promise<ApplyReport> {
  const out = report();
  for (const ch of changes) {
    switch (ch.entityType) {
      case 'note':
        await applyNote(tx, ch, out);
        break;
      case 'collection':
        await applyCollection(tx, ch, out);
        break;
      case 'tag':
        await applyTag(tx, ch, out);
        break;
      case 'note_tag':
        await applyMembership(tx, ch, out);
        break;
      case 'attachment':
        await applyAttachment(tx, ch, out);
        break;
    }
  }
  return out;
}

async function isDirty(tx: SqlDb, table: string, id: string): Promise<boolean> {
  const r = await tx.getFirstAsync<{ dirty: number }>(`SELECT dirty FROM ${table} WHERE id = ?`, [
    id,
  ]);
  return r?.dirty === 1;
}

async function applyNote(tx: SqlDb, ch: SyncChange, out: ApplyReport): Promise<void> {
  const id = ch.entityKey;
  if (await isDirty(tx, 'notes', id)) return;
  const n = ch.data as NoteDto | null;
  out.touched.add('notes').add('note_links');

  if (!n) {
    if (ch.op === 'delete') {
      // Purged on the server: remove everything local about it.
      await tx.runAsync(`DELETE FROM note_links WHERE source_note_id = ?`, [id]);
      await tx.runAsync(`UPDATE note_links SET target_note_id = NULL WHERE target_note_id = ?`, [
        id,
      ]);
      await tx.runAsync(`DELETE FROM note_tags WHERE note_id = ?`, [id]);
      await tx.runAsync(`DELETE FROM note_versions_local WHERE note_id = ? AND conflict = 0`, [id]);
      await tx.runAsync(`DELETE FROM notes WHERE id = ?`, [id]);
    }
    return;
  }

  const titleNorm = normaliseTitle(n.title);
  await tx.runAsync(
    `INSERT INTO notes (id, title, title_norm, body_md, body_text, excerpt, word_count, collection_id,
       is_pinned, server_rev, local_rev, dirty, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, title_norm = excluded.title_norm,
       body_md = excluded.body_md, body_text = excluded.body_text, excerpt = excluded.excerpt,
       word_count = excluded.word_count, collection_id = excluded.collection_id,
       is_pinned = excluded.is_pinned, server_rev = excluded.server_rev, dirty = 0,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
    [
      id,
      n.title,
      titleNorm,
      n.bodyMd,
      stripMarkdown(n.bodyMd),
      excerpt(n.bodyMd),
      wordCount(n.bodyMd),
      n.collectionId,
      n.isPinned ? 1 : 0,
      n.serverRev,
      n.createdAt,
      n.updatedAt,
      n.deletedAt,
    ],
  );

  if (n.deletedAt) {
    await tx.runAsync(`UPDATE note_links SET target_note_id = NULL WHERE target_note_id = ?`, [id]);
    return;
  }
  await rewriteLinks(tx, id, n.bodyMd);
  if (titleNorm) {
    await tx.runAsync(
      `UPDATE note_links SET target_note_id = ? WHERE target_note_id IS NULL AND target_title_norm = ?`,
      [id, titleNorm],
    );
  }
}

async function applyCollection(tx: SqlDb, ch: SyncChange, out: ApplyReport): Promise<void> {
  const id = ch.entityKey;
  if (await isDirty(tx, 'collections', id)) return;
  out.touched.add('collections');
  const c = ch.data as (CollectionDto & { deletedAt?: string | null }) | null;

  if (ch.op === 'delete' || !c || c.deletedAt) {
    const row = await tx.getFirstAsync<{ parent_id: string | null }>(
      `SELECT parent_id FROM collections WHERE id = ?`,
      [id],
    );
    if (!row) return;
    // Same moves the server made (BR-08): notes and children go to the parent.
    await tx.runAsync(`UPDATE notes SET collection_id = ? WHERE collection_id = ? AND dirty = 0`, [
      row.parent_id,
      id,
    ]);
    await tx.runAsync(`UPDATE collections SET parent_id = ? WHERE parent_id = ? AND dirty = 0`, [
      row.parent_id,
      id,
    ]);
    await tx.runAsync(`UPDATE collections SET deleted_at = coalesce(deleted_at, ?) WHERE id = ?`, [
      now(),
      id,
    ]);
    out.touched.add('notes');
    return;
  }

  await tx.runAsync(
    `INSERT INTO collections (id, parent_id, name, icon, sort_order, server_rev, local_rev, dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name,
       icon = excluded.icon, sort_order = excluded.sort_order, server_rev = excluded.server_rev,
       dirty = 0, updated_at = excluded.updated_at, deleted_at = NULL`,
    [id, c.parentId, c.name, c.icon, c.sortOrder, c.serverRev, c.createdAt, c.updatedAt],
  );
}

async function applyTag(tx: SqlDb, ch: SyncChange, out: ApplyReport): Promise<void> {
  const id = ch.entityKey;
  if (await isDirty(tx, 'tags', id)) return;
  out.touched.add('tags');
  const t = ch.data as (TagDto & { deletedAt?: string | null }) | null;
  if (ch.op === 'delete' || !t || t.deletedAt) {
    const ts = now();
    await tx.runAsync(`UPDATE tags SET deleted_at = coalesce(deleted_at, ?) WHERE id = ?`, [
      ts,
      id,
    ]);
    await tx.runAsync(
      `UPDATE note_tags SET deleted_at = ? WHERE tag_id = ? AND deleted_at IS NULL AND dirty = 0`,
      [ts, id],
    );
    out.touched.add('note_tags');
    return;
  }
  const ts = now();
  await tx.runAsync(
    `INSERT INTO tags (id, name, name_norm, colour, server_rev, local_rev, dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_norm = excluded.name_norm,
       colour = excluded.colour, server_rev = excluded.server_rev, dirty = 0,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [id, t.name, t.name.toLowerCase(), t.colour, t.serverRev, ts, ts],
  );
}

/** Set-merge (BR-10): whichever of the local and server rows changed last wins. */
async function applyMembership(tx: SqlDb, ch: SyncChange, out: ApplyReport): Promise<void> {
  const [noteId, tagId] = ch.entityKey.split(':') as [string, string];
  const m = ch.data as { createdAt: string; deletedAt: string | null } | null;
  const local = await tx.getFirstAsync<NoteTagRow>(
    `SELECT * FROM note_tags WHERE note_id = ? AND tag_id = ?`,
    [noteId, tagId],
  );
  const serverState = m ?? { createdAt: now(), deletedAt: now() };
  if (local?.dirty === 1) {
    const stamp = (r: { createdAt: string; deletedAt: string | null }) =>
      Math.max(Date.parse(r.createdAt), r.deletedAt ? Date.parse(r.deletedAt) : 0);
    const localState = { createdAt: local.created_at, deletedAt: local.deleted_at };
    if (stamp(localState) >= stamp(serverState)) return;
  }
  await tx.runAsync(
    `INSERT INTO note_tags (note_id, tag_id, created_at, deleted_at, dirty) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(note_id, tag_id) DO UPDATE SET created_at = excluded.created_at,
       deleted_at = excluded.deleted_at, dirty = 0`,
    [noteId, tagId, serverState.createdAt, serverState.deletedAt],
  );
  out.touched.add('note_tags');
}

async function applyAttachment(tx: SqlDb, ch: SyncChange, out: ApplyReport): Promise<void> {
  const id = ch.entityKey;
  if (await isDirty(tx, 'attachments', id)) return;
  out.touched.add('attachments');
  const a = ch.data as AttachmentDto | null;
  if (ch.op === 'delete' || !a) {
    await tx.runAsync(`UPDATE attachments SET deleted_at = coalesce(deleted_at, ?) WHERE id = ?`, [
      now(),
      id,
    ]);
    return;
  }
  await tx.runAsync(
    `INSERT INTO attachments (id, note_id, filename, mime_type, size_bytes, sha256, status, width, height,
       server_rev, local_rev, dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET note_id = excluded.note_id, filename = excluded.filename,
       status = excluded.status, width = excluded.width, height = excluded.height,
       server_rev = excluded.server_rev, dirty = 0, updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      id,
      a.noteId,
      a.filename,
      a.mimeType,
      a.sizeBytes,
      a.sha256,
      a.status,
      a.width,
      a.height,
      a.serverRev,
      a.createdAt,
      a.updatedAt,
    ],
  );
}

/** Merges several reports' touched tables and errors. */
export function mergeReports(...reports: ApplyReport[]): ApplyReport {
  const out = report();
  for (const r of reports) {
    r.touched.forEach((t) => out.touched.add(t));
    out.errors.push(...r.errors);
  }
  return out;
}
