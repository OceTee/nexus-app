// Notes on the device (TDD Section G, Local database requirements). Every
// logical write is one exclusive transaction: row, revision bump, dirty flag,
// link rewrite, FTS (trigger), coalesced outbox op and a local version.

import {
  excerpt,
  normaliseTitle,
  stripMarkdown,
  uniqueLinkTargets,
  wordCount,
} from '@nexus/shared';
import { uuidv7 } from '../../infra/ids';
import { transaction, type SqlDb } from '../../infra/sql';
import { events } from '../events';
import type { NoteRow } from '../rows';
import type { OutboxRepo } from './outbox';

export const LOCAL_VERSIONS_PER_NOTE = 10;

export interface Note {
  id: string;
  title: string;
  bodyMd: string;
  excerpt: string;
  wordCount: number;
  collectionId: string | null;
  isPinned: boolean;
  serverRev: number;
  localRev: number;
  dirty: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteInput {
  id?: string;
  title: string;
  bodyMd: string;
  collectionId?: string | null;
  isPinned?: boolean;
}

export interface NoteListFilter {
  collectionId?: string;
  /** Notes outside any collection. */
  unfiled?: boolean;
  tagId?: string;
  pinned?: boolean;
  /** `recent` ignores pinning and orders by last edit only. */
  order?: 'default' | 'recent';
  limit?: number;
  offset?: number;
}

export function toNote(r: NoteRow): Note {
  return {
    id: r.id,
    title: r.title,
    bodyMd: r.body_md,
    excerpt: r.excerpt,
    wordCount: r.word_count,
    collectionId: r.collection_id,
    isPinned: r.is_pinned === 1,
    serverRev: r.server_rev,
    localRev: r.local_rev,
    dirty: r.dirty === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

const now = () => new Date().toISOString();

export class NotesRepo {
  constructor(
    private readonly db: () => SqlDb,
    private readonly outbox: OutboxRepo,
  ) {}

  async get(id: string): Promise<Note | null> {
    const r = await this.db().getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]);
    return r ? toNote(r) : null;
  }

  /** Live notes, pinned first, most recently edited first. */
  async list(f: NoteListFilter = {}): Promise<Note[]> {
    const where = ['n.deleted_at IS NULL'];
    const params: (string | number)[] = [];
    if (f.collectionId) {
      where.push('n.collection_id = ?');
      params.push(f.collectionId);
    }
    if (f.unfiled) where.push('n.collection_id IS NULL');
    if (f.pinned !== undefined) {
      where.push('n.is_pinned = ?');
      params.push(f.pinned ? 1 : 0);
    }
    if (f.tagId) {
      where.push(
        'EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag_id = ? AND t.deleted_at IS NULL)',
      );
      params.push(f.tagId);
    }
    params.push(f.limit ?? 200, f.offset ?? 0);
    const rows = await this.db().getAllAsync<NoteRow>(
      `SELECT n.* FROM notes n WHERE ${where.join(' AND ')}
       ORDER BY ${f.order === 'recent' ? '' : 'n.is_pinned DESC, '}n.updated_at DESC LIMIT ? OFFSET ?`,
      params,
    );
    return rows.map(toNote);
  }

  /** Live note whose title normalises to the same text (wiki-links resolve by title). */
  async findByTitle(title: string, exceptId?: string): Promise<Note | null> {
    const norm = normaliseTitle(title);
    if (!norm) return null;
    const r = await this.db().getFirstAsync<NoteRow>(
      `SELECT * FROM notes WHERE title_norm = ? AND deleted_at IS NULL AND id != ?
       ORDER BY created_at LIMIT 1`,
      [norm, exceptId ?? ''],
    );
    return r ? toNote(r) : null;
  }

  async setPinned(id: string, isPinned: boolean): Promise<void> {
    const n = await this.get(id);
    if (n && n.isPinned !== isPinned) {
      await this.save({ id, title: n.title, bodyMd: n.bodyMd, isPinned });
    }
  }

  async move(id: string, collectionId: string | null): Promise<void> {
    const n = await this.get(id);
    if (n && n.collectionId !== collectionId) {
      await this.save({ id, title: n.title, bodyMd: n.bodyMd, collectionId });
    }
  }

  /** Wraps the first unlinked mention of `title` in a note's body with [[ ]] (S-14). */
  async linkMention(sourceId: string, title: string): Promise<boolean> {
    const n = await this.get(sourceId);
    if (!n) return false;
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Whole-word match that is not already inside [[ ]].
    const re = new RegExp(
      `(?<!\\[\\[)(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])(?!\\]\\])`,
      'iu',
    );
    const m = re.exec(n.bodyMd);
    if (!m) return false;
    const bodyMd = `${n.bodyMd.slice(0, m.index)}[[${m[1]}]]${n.bodyMd.slice(m.index + m[1]!.length)}`;
    await this.save({ id: sourceId, title: n.title, bodyMd });
    return true;
  }

  async trash(): Promise<Note[]> {
    const rows = await this.db().getAllAsync<NoteRow>(
      `SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    );
    return rows.map(toNote);
  }

  /** Creates or updates a note and queues it for sync. */
  async save(input: NoteInput): Promise<Note> {
    const id = input.id ?? uuidv7();
    const note = await transaction(this.db(), async (tx) => {
      const current = await tx.getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]);
      const ts = now();
      const titleNorm = normaliseTitle(input.title);
      const fields = {
        title: input.title,
        title_norm: titleNorm,
        body_md: input.bodyMd,
        body_text: stripMarkdown(input.bodyMd),
        excerpt: excerpt(input.bodyMd),
        word_count: wordCount(input.bodyMd),
        collection_id:
          input.collectionId === undefined ? (current?.collection_id ?? null) : input.collectionId,
        is_pinned: (input.isPinned ?? current?.is_pinned === 1) ? 1 : 0,
      };

      if (current) {
        await tx.runAsync(
          `UPDATE notes SET title = ?, title_norm = ?, body_md = ?, body_text = ?, excerpt = ?,
             word_count = ?, collection_id = ?, is_pinned = ?, local_rev = local_rev + 1,
             dirty = 1, updated_at = ? WHERE id = ?`,
          [
            fields.title,
            fields.title_norm,
            fields.body_md,
            fields.body_text,
            fields.excerpt,
            fields.word_count,
            fields.collection_id,
            fields.is_pinned,
            ts,
            id,
          ],
        );
      } else {
        await tx.runAsync(
          `INSERT INTO notes (id, title, title_norm, body_md, body_text, excerpt, word_count,
             collection_id, is_pinned, local_rev, dirty, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
          [
            id,
            fields.title,
            fields.title_norm,
            fields.body_md,
            fields.body_text,
            fields.excerpt,
            fields.word_count,
            fields.collection_id,
            fields.is_pinned,
            ts,
            ts,
          ],
        );
      }

      await rewriteLinks(tx, id, input.bodyMd);
      // Ghost links to this title now resolve.
      if (titleNorm) {
        await tx.runAsync(
          `UPDATE note_links SET target_note_id = ? WHERE target_note_id IS NULL AND target_title_norm = ?`,
          [id, titleNorm],
        );
      }

      const row = (await tx.getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]))!;
      await this.outbox.enqueue(tx, {
        entityType: 'note',
        entityId: id,
        op: 'upsert',
        baseRev: row.server_rev,
        payload: {
          title: row.title,
          bodyMd: row.body_md,
          collectionId: row.collection_id,
          isPinned: row.is_pinned === 1,
          tagIds: [],
        },
      });
      await snapshot(tx, row);
      return toNote(row);
    });
    events.emit('notes', 'note_links', 'outbox', 'note_versions_local');
    return note;
  }

  /** Moves a note to Trash and queues the delete. */
  async trashNote(id: string): Promise<void> {
    await transaction(this.db(), async (tx) => {
      const row = await tx.getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]);
      if (!row || row.deleted_at) return;
      await tx.runAsync(
        `UPDATE notes SET deleted_at = ?, local_rev = local_rev + 1, dirty = 1 WHERE id = ?`,
        [now(), id],
      );
      await tx.runAsync(`UPDATE note_links SET target_note_id = NULL WHERE target_note_id = ?`, [
        id,
      ]);
      await this.outbox.enqueue(tx, {
        entityType: 'note',
        entityId: id,
        op: 'delete',
        baseRev: row.server_rev,
        payload: {},
        knownToServer: row.server_rev > 0,
      });
    });
    events.emit('notes', 'note_links', 'outbox');
  }

  /** Restores a note from Trash (queued as an upsert). */
  async restore(id: string): Promise<void> {
    await transaction(this.db(), async (tx) => {
      const row = await tx.getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]);
      if (!row?.deleted_at) return;
      await tx.runAsync(
        `UPDATE notes SET deleted_at = NULL, local_rev = local_rev + 1, dirty = 1, updated_at = ? WHERE id = ?`,
        [now(), id],
      );
      await tx.runAsync(
        `UPDATE note_links SET target_note_id = ? WHERE target_note_id IS NULL AND target_title_norm = ?`,
        [id, row.title_norm],
      );
      await this.outbox.enqueue(tx, {
        entityType: 'note',
        entityId: id,
        op: 'upsert',
        baseRev: row.server_rev,
        payload: {
          title: row.title,
          bodyMd: row.body_md,
          collectionId: row.collection_id,
          isPinned: row.is_pinned === 1,
          tagIds: [],
        },
      });
    });
    events.emit('notes', 'note_links', 'outbox');
  }
}

/** Permanently removes trashed notes from this device (S-37). The delete op is already queued. */
export async function purgeNotes(db: SqlDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await transaction(db, async (tx) => {
    for (const id of ids) {
      const row = await tx.getFirstAsync<NoteRow>(`SELECT deleted_at FROM notes WHERE id = ?`, [
        id,
      ]);
      if (!row?.deleted_at) continue;
      await tx.runAsync(`DELETE FROM note_links WHERE source_note_id = ?`, [id]);
      await tx.runAsync(`DELETE FROM note_tags WHERE note_id = ?`, [id]);
      await tx.runAsync(`DELETE FROM note_versions_local WHERE note_id = ?`, [id]);
      await tx.runAsync(`DELETE FROM conflicts WHERE note_id = ?`, [id]);
      await tx.runAsync(`DELETE FROM notes WHERE id = ?`, [id]);
    }
  });
  events.emit('notes', 'note_links', 'note_tags', 'note_versions_local', 'conflicts');
}

/** Replaces a note's outgoing links with those in its body, resolving known titles. */
export async function rewriteLinks(tx: SqlDb, noteId: string, bodyMd: string): Promise<void> {
  await tx.runAsync(`DELETE FROM note_links WHERE source_note_id = ?`, [noteId]);
  for (const target of uniqueLinkTargets(bodyMd)) {
    const hit = await tx.getFirstAsync<{ id: string }>(
      `SELECT id FROM notes WHERE title_norm = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [target],
    );
    await tx.runAsync(
      `INSERT INTO note_links (source_note_id, target_title_norm, target_note_id) VALUES (?, ?, ?)`,
      [noteId, target, hit?.id ?? null],
    );
  }
}

/** Keeps the last 10 local versions of a note for offline restore. */
async function snapshot(tx: SqlDb, row: NoteRow): Promise<void> {
  await tx.runAsync(
    `INSERT INTO note_versions_local (id, note_id, rev, base_rev, title, body_md, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'local', ?)`,
    [uuidv7(), row.id, row.local_rev, row.server_rev, row.title, row.body_md, row.updated_at],
  );
  await tx.runAsync(
    `DELETE FROM note_versions_local WHERE note_id = ? AND conflict = 0 AND id NOT IN (
       SELECT id FROM note_versions_local WHERE note_id = ? AND conflict = 0
       ORDER BY created_at DESC, rev DESC LIMIT ?)`,
    [row.id, row.id, LOCAL_VERSIONS_PER_NOTE],
  );
}
