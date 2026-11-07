// Small repositories: sync state, local versions, conflicts, attachments.

import type { SqlDb } from '../../infra/sql';
import { events } from '../events';
import type { AttachmentRow, ConflictRow, LocalVersionRow } from '../rows';

export class SyncStateRepo {
  constructor(private readonly db: () => SqlDb) {}

  async get(key: string, tx: SqlDb = this.db()): Promise<string | null> {
    const r = await tx.getFirstAsync<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = ?`,
      [key],
    );
    return r?.value ?? null;
  }

  async set(key: string, value: string, tx: SqlDb = this.db()): Promise<void> {
    await tx.runAsync(
      `INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  async cursor(tx?: SqlDb): Promise<number> {
    return Number((await this.get('cursor', tx)) ?? 0);
  }

  async setCursor(cursor: number, tx?: SqlDb): Promise<void> {
    await this.set('cursor', String(cursor), tx);
  }

  async schemaVersion(): Promise<number> {
    return Number((await this.get('schema_version')) ?? 0);
  }
}

export class VersionsRepo {
  constructor(private readonly db: () => SqlDb) {}

  /** The last local versions of a note, newest first (offline restore). */
  async local(noteId: string): Promise<LocalVersionRow[]> {
    return this.db().getAllAsync<LocalVersionRow>(
      `SELECT * FROM note_versions_local WHERE note_id = ? ORDER BY created_at DESC, rev DESC`,
      [noteId],
    );
  }

  async get(id: string): Promise<LocalVersionRow | null> {
    return this.db().getFirstAsync<LocalVersionRow>(
      `SELECT * FROM note_versions_local WHERE id = ?`,
      [id],
    );
  }
}

export class ConflictsRepo {
  constructor(private readonly db: () => SqlDb) {}

  async open(noteId?: string): Promise<ConflictRow[]> {
    return noteId
      ? this.db().getAllAsync<ConflictRow>(
          `SELECT * FROM conflicts WHERE note_id = ? AND resolved_at IS NULL ORDER BY created_at DESC`,
          [noteId],
        )
      : this.db().getAllAsync<ConflictRow>(
          `SELECT * FROM conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC`,
        );
  }

  async get(id: string): Promise<ConflictRow | null> {
    return this.db().getFirstAsync<ConflictRow>(`SELECT * FROM conflicts WHERE id = ?`, [id]);
  }

  async add(tx: SqlDb, c: Omit<ConflictRow, 'resolved_at'>): Promise<void> {
    await tx.runAsync(
      `INSERT INTO conflicts (id, note_id, version_id, server_rev, device_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      [c.id, c.note_id, c.version_id, c.server_rev, c.device_name, c.created_at],
    );
  }

  /** Resolves every open conflict on a note (a resolution settles the whole note). */
  async resolveNote(noteId: string): Promise<void> {
    await this.db().runAsync(
      `UPDATE conflicts SET resolved_at = ? WHERE note_id = ? AND resolved_at IS NULL`,
      [new Date().toISOString(), noteId],
    );
    events.emit('conflicts');
  }

  async resolve(id: string): Promise<void> {
    await this.db().runAsync(`UPDATE conflicts SET resolved_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      id,
    ]);
    events.emit('conflicts');
  }
}

export class AttachmentsRepo {
  constructor(private readonly db: () => SqlDb) {}

  async forNote(noteId: string): Promise<AttachmentRow[]> {
    return this.db().getAllAsync<AttachmentRow>(
      `SELECT * FROM attachments WHERE note_id = ? AND deleted_at IS NULL ORDER BY created_at`,
      [noteId],
    );
  }
}
