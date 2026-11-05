// Minimal two-client simulator, server side (TDD design decision D-08).
// Each client keeps a local copy of notes and tag memberships, an outbox of
// ops, and a cursor, and syncs through POST /v1/sync like the app will.

import type { NoteDto, OpResult, SyncChange, SyncOp } from '@nexus/shared';
import { v7 as uuidv7 } from 'uuid';
import { expect } from 'vitest';
import { bearer, type TestApp } from './testApp';

export interface LocalNote {
  id: string;
  title: string;
  bodyMd: string;
  serverRev: number;
  dirty: boolean;
  deleted: boolean;
}

export class SimClient {
  notes = new Map<string, LocalNote>();
  memberships = new Set<string>(); // `${noteId}:${tagId}`
  outbox: SyncOp[] = [];
  cursor = 0;
  conflicts: string[] = [];

  constructor(
    private readonly t: TestApp,
    readonly deviceId: string,
    private accessToken: string,
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  createNote(title: string, bodyMd = ''): string {
    const id = uuidv7();
    this.notes.set(id, { id, title, bodyMd, serverRev: 0, dirty: true, deleted: false });
    this.queueUpsert(id, 0);
    return id;
  }

  editNote(id: string, bodyMd: string): void {
    const n = this.notes.get(id);
    if (!n || n.deleted) return;
    n.bodyMd = bodyMd;
    n.dirty = true;
    // Coalesce: a pending upsert keeps its original base revision.
    const pending = this.outbox.find((o) => o.type === 'note.upsert' && o.entityId === id);
    if (pending && pending.type === 'note.upsert') {
      pending.payload = { ...pending.payload, bodyMd };
    } else {
      this.queueUpsert(id, n.serverRev);
    }
  }

  deleteNote(id: string): void {
    const n = this.notes.get(id);
    if (!n || n.deleted) return;
    n.deleted = true;
    n.dirty = true;
    this.outbox.push({
      opId: uuidv7(),
      createdAt: this.now(),
      type: 'note.delete',
      entityId: id,
      baseRev: n.serverRev,
    });
  }

  tag(noteId: string, tagId: string, add: boolean): void {
    const key = `${noteId}:${tagId}`;
    if (add) this.memberships.add(key);
    else this.memberships.delete(key);
    this.outbox.push({
      opId: uuidv7(),
      createdAt: this.now(),
      type: add ? 'note_tag.add' : 'note_tag.remove',
      noteId,
      tagId,
    });
  }

  private queueUpsert(id: string, baseRev: number): void {
    const n = this.notes.get(id)!;
    this.outbox.push({
      opId: uuidv7(),
      createdAt: this.now(),
      type: 'note.upsert',
      entityId: id,
      baseRev,
      payload: {
        title: n.title,
        bodyMd: n.bodyMd,
        collectionId: null,
        isPinned: false,
        tagIds: [],
      },
    });
  }

  /** Pushes the outbox (batches of 100) and pulls until `hasMore` is false. */
  async sync(): Promise<void> {
    let more = true;
    while (more) {
      const ops = this.outbox.slice(0, 100);
      const res = await this.t.http
        .post('/v1/sync')
        .set(bearer(this.accessToken))
        .send({ deviceId: this.deviceId, cursor: this.cursor, ops, clientSchema: 1 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      this.applyResults(ops, res.body.results as OpResult[]);
      this.applyChanges(res.body.changes as SyncChange[]);
      this.cursor = res.body.cursor;
      more = res.body.hasMore || this.outbox.length > 0;
    }
  }

  private applyResults(ops: SyncOp[], results: OpResult[]): void {
    results.forEach((r, i) => {
      const op = ops[i]!;
      this.outbox = this.outbox.filter((o) => o.opId !== op.opId);
      if (op.type !== 'note.upsert' && op.type !== 'note.delete') return;
      const n = this.notes.get(op.entityId);
      if (!n) return;
      if (r.status === 'applied') {
        n.serverRev = r.serverRev ?? n.serverRev;
        if (!this.outbox.some((o) => 'entityId' in o && o.entityId === n.id)) n.dirty = false;
      } else if (r.status === 'conflict') {
        this.conflicts.push(n.id);
        n.dirty = false; // the server copy arrives in changes and replaces the local one
      } else if (op.type === 'note.delete' || r.error?.code === 'NOT_FOUND') {
        n.dirty = false;
      }
    });
  }

  private applyChanges(changes: SyncChange[]): void {
    for (const c of changes) {
      if (c.entityType === 'note' && c.data) {
        const d = c.data as NoteDto;
        const local = this.notes.get(d.id);
        if (local?.dirty) continue; // the pending local edit wins until the server decides
        this.notes.set(d.id, {
          id: d.id,
          title: d.title,
          bodyMd: d.bodyMd,
          serverRev: d.serverRev,
          dirty: false,
          deleted: d.deletedAt !== null,
        });
      }
      if (c.entityType === 'note_tag') {
        const d = c.data as { deletedAt: string | null } | null;
        if (!d || d.deletedAt) this.memberships.delete(c.entityKey);
        else this.memberships.add(c.entityKey);
      }
    }
  }

  /** Comparable view of local state. */
  view() {
    return {
      notes: [...this.notes.values()]
        .map((n) => ({ id: n.id, bodyMd: n.bodyMd, serverRev: n.serverRev, deleted: n.deleted }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      memberships: [...this.memberships].sort(),
    };
  }
}
