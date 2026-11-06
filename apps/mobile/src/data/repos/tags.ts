import { applyMembershipOp, isLive } from '@nexus/shared';
import { uuidv7 } from '../../infra/ids';
import { transaction, type SqlDb } from '../../infra/sql';
import { events } from '../events';
import type { NoteTagRow, TagRow } from '../rows';
import type { OutboxRepo } from './outbox';

export interface Tag {
  id: string;
  name: string;
  colour: string | null;
  noteCount: number;
  serverRev: number;
  dirty: boolean;
}

export class DuplicateTagError extends Error {
  constructor(name: string) {
    super(`A tag named "${name}" already exists`);
    this.name = 'DuplicateTagError';
  }
}

const now = () => new Date().toISOString();

export class TagsRepo {
  constructor(
    private readonly db: () => SqlDb,
    private readonly outbox: OutboxRepo,
  ) {}

  /** Live tags with live-note counts, alphabetical. */
  async list(): Promise<Tag[]> {
    const rows = await this.db().getAllAsync<TagRow & { note_count: number }>(
      `SELECT t.*, (SELECT count(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id
                    WHERE nt.tag_id = t.id AND nt.deleted_at IS NULL AND n.deleted_at IS NULL) AS note_count
       FROM tags t WHERE t.deleted_at IS NULL ORDER BY t.name_norm`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      colour: r.colour,
      noteCount: Number(r.note_count),
      serverRev: r.server_rev,
      dirty: r.dirty === 1,
    }));
  }

  async forNote(noteId: string): Promise<Tag[]> {
    const ids = await this.db().getAllAsync<{ tag_id: string }>(
      `SELECT tag_id FROM note_tags WHERE note_id = ? AND deleted_at IS NULL ORDER BY created_at`,
      [noteId],
    );
    const all = new Map((await this.list()).map((t) => [t.id, t]));
    return ids.map((r) => all.get(r.tag_id)).filter((t): t is Tag => Boolean(t));
  }

  /** Creates or renames/recolours a tag; names are unique ignoring case (BR-09). */
  async save(input: { id?: string; name: string; colour?: string | null }): Promise<string> {
    const id = input.id ?? uuidv7();
    const name = input.name.trim();
    await transaction(this.db(), async (tx) => {
      const clash = await tx.getFirstAsync<{ id: string }>(
        `SELECT id FROM tags WHERE name_norm = ? AND deleted_at IS NULL AND id != ?`,
        [name.toLowerCase(), id],
      );
      if (clash) throw new DuplicateTagError(name);
      const current = await tx.getFirstAsync<TagRow>(`SELECT * FROM tags WHERE id = ?`, [id]);
      const colour = input.colour === undefined ? (current?.colour ?? null) : input.colour;
      const ts = now();
      if (current) {
        await tx.runAsync(
          `UPDATE tags SET name = ?, name_norm = ?, colour = ?, local_rev = local_rev + 1, dirty = 1,
             updated_at = ?, deleted_at = NULL WHERE id = ?`,
          [name, name.toLowerCase(), colour, ts, id],
        );
      } else {
        await tx.runAsync(
          `INSERT INTO tags (id, name, name_norm, colour, local_rev, dirty, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
          [id, name, name.toLowerCase(), colour, ts, ts],
        );
      }
      await this.outbox.enqueue(tx, {
        entityType: 'tag',
        entityId: id,
        op: 'upsert',
        baseRev: current?.server_rev ?? 0,
        payload: { name, colour },
      });
    });
    events.emit('tags', 'outbox');
    return id;
  }

  async remove(id: string): Promise<void> {
    await transaction(this.db(), async (tx) => {
      const row = await tx.getFirstAsync<TagRow>(`SELECT * FROM tags WHERE id = ?`, [id]);
      if (!row || row.deleted_at) return;
      const ts = now();
      await tx.runAsync(
        `UPDATE tags SET deleted_at = ?, local_rev = local_rev + 1, dirty = 1 WHERE id = ?`,
        [ts, id],
      );
      await tx.runAsync(
        `UPDATE note_tags SET deleted_at = ? WHERE tag_id = ? AND deleted_at IS NULL`,
        [ts, id],
      );
      await this.outbox.enqueue(tx, {
        entityType: 'tag',
        entityId: id,
        op: 'delete',
        baseRev: row.server_rev,
        payload: {},
        knownToServer: row.server_rev > 0,
      });
    });
    events.emit('tags', 'note_tags', 'outbox');
  }

  /** Adds or removes a tag on a note with the shared set-merge rule (BR-10). */
  async setMembership(noteId: string, tagId: string, add: boolean): Promise<void> {
    const createdAt = now();
    await transaction(this.db(), async (tx) => {
      const row = await tx.getFirstAsync<NoteTagRow>(
        `SELECT * FROM note_tags WHERE note_id = ? AND tag_id = ?`,
        [noteId, tagId],
      );
      const current = row ? { createdAt: row.created_at, deletedAt: row.deleted_at } : null;
      const outcome = applyMembershipOp(current, { kind: add ? 'add' : 'remove', createdAt });
      if (!outcome.changed) return;
      await tx.runAsync(
        `INSERT INTO note_tags (note_id, tag_id, created_at, deleted_at, dirty) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(note_id, tag_id) DO UPDATE SET created_at = excluded.created_at,
           deleted_at = excluded.deleted_at, dirty = 1`,
        [noteId, tagId, outcome.next.createdAt, outcome.next.deletedAt],
      );
      await this.outbox.enqueue(tx, {
        entityType: 'note_tag',
        entityId: `${noteId}:${tagId}`,
        op: isLive(outcome.next) ? 'add' : 'remove',
        baseRev: null,
        payload: { noteId, tagId },
      });
    });
    events.emit('note_tags', 'outbox');
  }
}
