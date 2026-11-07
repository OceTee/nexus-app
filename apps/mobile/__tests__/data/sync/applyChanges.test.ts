import type {
  AttachmentDto,
  CollectionDto,
  ConflictDto,
  NoteDto,
  SyncChange,
  TagDto,
} from '@nexus/shared';
import { createRepos, type Repos } from '../../../src/data/repos';
import type {
  AttachmentRow,
  CollectionRow,
  ConflictRow,
  LocalVersionRow,
  NoteRow,
  NoteTagRow,
  TagRow,
} from '../../../src/data/rows';
import {
  applyChanges,
  applyResults,
  mergeReports,
  storeConflicts,
  type ApplyReport,
} from '../../../src/data/sync/applyChanges';
import { uuidv7 } from '../../../src/infra/ids';
import type { SqlDb } from '../../../src/infra/sql';
import { createTestDb } from '../../../src/test/nodeSqlite';

let db: SqlDb;
let r: Repos;

beforeEach(async () => {
  db = await createTestDb();
  r = createRepos(() => db);
});

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';

const noteRow = (id: string) =>
  db.getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]) as Promise<NoteRow>;
const outbox = () => r.outbox.all(db);
const touched = (rep: ApplyReport) => [...rep.touched].sort();

/** Inserts a synced (clean) note directly, bypassing the outbox. */
async function cleanNote(id: string, title: string, extra: Partial<NoteRow> = {}) {
  const row = { server_rev: 1, dirty: 0, collection_id: null, ...extra };
  await db.runAsync(
    `INSERT INTO notes (id, title, title_norm, body_md, collection_id, server_rev, dirty, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)`,
    [id, title, title.toLowerCase(), row.collection_id, row.server_rev, row.dirty, T0, T0],
  );
}

function noteDto(over: Partial<NoteDto> = {}): NoteDto {
  return {
    id: uuidv7(),
    title: 'Server title',
    bodyMd: 'Server **body**',
    excerpt: '',
    collectionId: null,
    isPinned: false,
    wordCount: 2,
    serverRev: 4,
    tagIds: [],
    createdAt: T0,
    updatedAt: T1,
    deletedAt: null,
    ...over,
  };
}

const change = (
  entityType: SyncChange['entityType'],
  entityKey: string,
  data: unknown,
  op: SyncChange['op'] = 'upsert',
): SyncChange => ({ seq: 1, entityType, entityKey, op, rev: 1, data });

describe('applyResults', () => {
  it('returns an empty report for no results', async () => {
    const rep = await applyResults(db, []);
    expect(touched(rep)).toEqual([]);
    expect(rep.errors).toEqual([]);
  });

  it('records the server revision, clears dirty and drops the acknowledged op', async () => {
    const n = await r.notes.save({ title: 'A', bodyMd: 'one' });
    const [op] = await r.outbox.takeBatch(db);
    const rep = await applyResults(db, [{ opId: op!.opId, status: 'applied', serverRev: 5 }]);
    expect(await noteRow(n.id)).toMatchObject({ server_rev: 5, dirty: 0 });
    expect(await outbox()).toEqual([]);
    expect(touched(rep)).toEqual(['notes', 'outbox']);
  });

  it('keeps dirty and rebases a newer queued edit onto the new revision', async () => {
    const n = await r.notes.save({ title: 'A', bodyMd: 'one' });
    const [op] = await r.outbox.takeBatch(db);
    // Edited again while the first op was in flight: a second, pending op based on rev 0.
    await r.notes.save({ id: n.id, title: 'A', bodyMd: 'two' });
    await applyResults(db, [{ opId: op!.opId, status: 'applied', serverRev: 5 }]);
    expect(await noteRow(n.id)).toMatchObject({ server_rev: 5, dirty: 1 });
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', base_rev: 5 });
  });

  it('clears dirty without touching server_rev when no revision is returned', async () => {
    const id = await r.collections.save({ name: 'Inbox' });
    const [op] = await r.outbox.takeBatch(db);
    const rep = await applyResults(db, [{ opId: op!.opId, status: 'applied' }]);
    const row = await db.getFirstAsync<CollectionRow>(`SELECT * FROM collections WHERE id = ?`, [
      id,
    ]);
    expect(row).toMatchObject({ server_rev: 0, dirty: 0 });
    expect(touched(rep)).toEqual(['collections', 'outbox']);
  });

  it('ignores results for ops it does not know', async () => {
    const rep = await applyResults(db, [{ opId: uuidv7(), status: 'applied', serverRev: 1 }]);
    expect(touched(rep)).toEqual(['outbox']);
  });

  it('only drops ops of an unknown entity type', async () => {
    await db.runAsync(
      `INSERT INTO outbox (op_id, entity_type, entity_id, op, payload, base_rev, status, created_at)
       VALUES ('op-x', 'gadget', 'g1', 'upsert', '{}', 0, 'inflight', ?)`,
      [T0],
    );
    const rep = await applyResults(db, [{ opId: 'op-x', status: 'applied', serverRev: 2 }]);
    expect(touched(rep)).toEqual(['outbox']);
    expect(await outbox()).toEqual([]);
  });

  describe('note_tag results', () => {
    async function taggedNote() {
      const n = await r.notes.save({ title: 'N', bodyMd: '' });
      const tagId = await r.tags.save({ name: 'work' });
      await r.tags.setMembership(n.id, tagId, true);
      const ops = await r.outbox.takeBatch(db);
      return { noteId: n.id, tagId, ops };
    }
    const membership = (noteId: string, tagId: string) =>
      db.getFirstAsync<NoteTagRow>(`SELECT * FROM note_tags WHERE note_id = ? AND tag_id = ?`, [
        noteId,
        tagId,
      ]);

    it('clears the membership dirty flag', async () => {
      const { noteId, tagId, ops } = await taggedNote();
      const rep = await applyResults(
        db,
        ops.map((o) => ({ opId: o.opId, status: 'applied' as const, serverRev: 1 })),
      );
      expect((await membership(noteId, tagId))!.dirty).toBe(0);
      expect(rep.touched.has('note_tags')).toBe(true);
    });

    it('keeps the flag while a newer membership change is queued', async () => {
      const { noteId, tagId, ops } = await taggedNote();
      await r.tags.setMembership(noteId, tagId, false);
      const addOp = ops.find((o) => o.type === 'note_tag.add')!;
      await applyResults(db, [{ opId: addOp.opId, status: 'applied' }]);
      expect((await membership(noteId, tagId))!.dirty).toBe(1);
    });
  });

  describe('conflict results', () => {
    const versions = (noteId: string) =>
      db.getAllAsync<LocalVersionRow>(
        `SELECT * FROM note_versions_local WHERE note_id = ? AND conflict = 1`,
        [noteId],
      );

    it("keeps this device's losing copy and lets the server copy win", async () => {
      const n = await r.notes.save({ title: 'Mine', bodyMd: 'my body' });
      const [op] = await r.outbox.takeBatch(db);
      const rep = await applyResults(db, [
        { opId: op!.opId, status: 'conflict', serverRev: 7, conflictVersionId: 'ver-1' },
      ]);
      expect(await versions(n.id)).toEqual([
        expect.objectContaining({
          id: 'ver-1',
          rev: 1,
          base_rev: 0,
          title: 'Mine',
          body_md: 'my body',
          source: 'conflict',
        }),
      ]);
      expect(await noteRow(n.id)).toMatchObject({ server_rev: 7, dirty: 0 });
      expect(rep.touched.has('note_versions_local')).toBe(true);
    });

    it('keeps dirty when a newer edit is queued', async () => {
      const n = await r.notes.save({ title: 'Mine', bodyMd: 'v1' });
      const [op] = await r.outbox.takeBatch(db);
      await r.notes.save({ id: n.id, title: 'Mine', bodyMd: 'v2' });
      await applyResults(db, [
        { opId: op!.opId, status: 'conflict', serverRev: 7, conflictVersionId: 'ver-1' },
      ]);
      expect((await noteRow(n.id)).dirty).toBe(1);
      expect(await versions(n.id)).toHaveLength(1);
    });

    it('stores empty text for a conflicting delete', async () => {
      const n = await r.notes.save({ title: 'Mine', bodyMd: 'v1' });
      await db.runAsync(`UPDATE notes SET server_rev = 2`);
      await r.outbox.remove(
        db,
        (await outbox()).map((o) => o.op_id),
      );
      await r.notes.trashNote(n.id);
      const [op] = await r.outbox.takeBatch(db);
      await applyResults(db, [
        { opId: op!.opId, status: 'conflict', serverRev: 3, conflictVersionId: 'ver-d' },
      ]);
      expect(await versions(n.id)).toEqual([
        expect.objectContaining({ id: 'ver-d', title: '', body_md: '' }),
      ]);
    });

    it('stores nothing without a conflict version id', async () => {
      const n = await r.notes.save({ title: 'Mine', bodyMd: 'v1' });
      const [op] = await r.outbox.takeBatch(db);
      const rep = await applyResults(db, [{ opId: op!.opId, status: 'conflict', serverRev: 7 }]);
      expect(await versions(n.id)).toEqual([]);
      expect(rep.touched.has('note_versions_local')).toBe(false);
    });
  });

  describe('rejected results', () => {
    it('reports the server error', async () => {
      await r.notes.save({ title: 'A', bodyMd: '' });
      const [op] = await r.outbox.takeBatch(db);
      const rep = await applyResults(db, [
        {
          opId: op!.opId,
          status: 'rejected',
          error: { code: 'VALIDATION', message: 'Title too long' },
        },
      ]);
      expect(rep.errors).toEqual([
        { code: 'VALIDATION', message: 'Title too long', entity: 'note.upsert' },
      ]);
    });

    it('falls back to a generic error', async () => {
      await r.tags.save({ name: 'x' });
      const [op] = await r.outbox.takeBatch(db);
      const rep = await applyResults(db, [{ opId: op!.opId, status: 'rejected' }]);
      expect(rep.errors).toEqual([
        { code: 'REJECTED', message: 'The server rejected a change', entity: 'tag.upsert' },
      ]);
    });

    it('sends a note purged elsewhere (NOT_FOUND) to Trash', async () => {
      const n = await r.notes.save({ title: 'Gone', bodyMd: '' });
      const [op] = await r.outbox.takeBatch(db);
      await applyResults(db, [
        { opId: op!.opId, status: 'rejected', error: { code: 'NOT_FOUND', message: 'nope' } },
      ]);
      const row = await noteRow(n.id);
      expect(row.deleted_at).not.toBeNull();
      expect(row.dirty).toBe(0);
    });

    it('does not trash anything for NOT_FOUND on other entities', async () => {
      const n = await r.notes.save({ title: 'Stays', bodyMd: '' });
      await r.outbox.remove(
        db,
        (await outbox()).map((o) => o.op_id),
      );
      await r.tags.save({ name: 'x' });
      const [op] = await r.outbox.takeBatch(db);
      await applyResults(db, [
        { opId: op!.opId, status: 'rejected', error: { code: 'NOT_FOUND', message: 'nope' } },
      ]);
      expect((await noteRow(n.id)).deleted_at).toBeNull();
    });
  });
});

describe('storeConflicts', () => {
  const dto = (versionId: string): ConflictDto => ({
    noteId: 'n1',
    versionId,
    serverRev: 3,
    deviceId: null,
    createdAt: T0,
  });

  it('stores each conflict once', async () => {
    await storeConflicts(db, [dto('v1')]);
    const rep = await storeConflicts(db, [dto('v1'), dto('v2')]);
    const rows = await db.getAllAsync<ConflictRow>(`SELECT * FROM conflicts ORDER BY id`);
    expect(rows).toEqual([
      expect.objectContaining({ id: 'v1', note_id: 'n1', version_id: 'v1', server_rev: 3 }),
      expect.objectContaining({ id: 'v2', resolved_at: null }),
    ]);
    expect(touched(rep)).toEqual(['conflicts']);
  });

  it('touches nothing for no conflicts', async () => {
    expect(touched(await storeConflicts(db, []))).toEqual([]);
  });
});

describe('applyChanges', () => {
  it('ignores unknown entity types', async () => {
    const rep = await applyChanges(db, [
      change('gadget' as SyncChange['entityType'], 'g1', { any: 1 }),
    ]);
    expect(touched(rep)).toEqual([]);
  });

  describe('notes', () => {
    it('inserts a server note with derived fields and resolves links both ways', async () => {
      await cleanNote('target', 'Target');
      // A note that already links to the incoming title (a ghost link).
      await db.runAsync(
        `INSERT INTO note_links (source_note_id, target_title_norm, target_note_id) VALUES ('other', 'server title', NULL)`,
      );
      const n = noteDto({ bodyMd: 'See [[Target]] **now**', isPinned: true });
      const rep = await applyChanges(db, [change('note', n.id, n)]);

      expect(await noteRow(n.id)).toMatchObject({
        title: 'Server title',
        title_norm: 'server title',
        body_text: 'See Target now',
        word_count: 3,
        is_pinned: 1,
        server_rev: 4,
        local_rev: 0,
        dirty: 0,
      });
      const links = await db.getAllAsync<{ source_note_id: string; target_note_id: string }>(
        `SELECT source_note_id, target_note_id FROM note_links ORDER BY source_note_id`,
      );
      expect(links).toEqual([
        { source_note_id: n.id, target_note_id: 'target' },
        { source_note_id: 'other', target_note_id: n.id },
      ]);
      expect(touched(rep)).toEqual(['note_links', 'notes']);
    });

    it('updates an existing clean note', async () => {
      await cleanNote('n1', 'Old');
      await applyChanges(db, [change('note', 'n1', noteDto({ id: 'n1', title: 'New' }))]);
      expect(await noteRow('n1')).toMatchObject({ title: 'New', server_rev: 4 });
    });

    it('accepts an untitled note', async () => {
      const n = noteDto({ title: '' });
      await applyChanges(db, [change('note', n.id, n)]);
      expect((await noteRow(n.id)).title_norm).toBe('');
    });

    it('skips a note with unsent local edits', async () => {
      const local = await r.notes.save({ title: 'Local', bodyMd: 'mine' });
      const rep = await applyChanges(db, [
        change('note', local.id, noteDto({ id: local.id, title: 'Server' })),
      ]);
      expect((await noteRow(local.id)).title).toBe('Local');
      expect(touched(rep)).toEqual([]);
    });

    it('unlinks incoming links when the server trashed the note', async () => {
      await cleanNote('n1', 'Doomed');
      await db.runAsync(
        `INSERT INTO note_links (source_note_id, target_title_norm, target_note_id) VALUES ('other', 'doomed', 'n1')`,
      );
      await applyChanges(db, [
        change('note', 'n1', noteDto({ id: 'n1', title: 'Doomed', deletedAt: T2 })),
      ]);
      expect((await noteRow('n1')).deleted_at).toBe(T2);
      const link = await db.getFirstAsync<{ target_note_id: string | null }>(
        `SELECT target_note_id FROM note_links WHERE source_note_id = 'other'`,
      );
      expect(link!.target_note_id).toBeNull();
    });

    it('removes everything local about a purged note but keeps conflict copies', async () => {
      await cleanNote('n1', 'Purged');
      await db.execAsync(`
        INSERT INTO note_links (source_note_id, target_title_norm, target_note_id) VALUES ('n1', 'x', NULL);
        INSERT INTO note_links (source_note_id, target_title_norm, target_note_id) VALUES ('other', 'purged', 'n1');
        INSERT INTO note_tags (note_id, tag_id, created_at) VALUES ('n1', 't1', '${T0}');
        INSERT INTO note_versions_local (id, note_id, rev, title, body_md, conflict, source, created_at)
          VALUES ('local-v', 'n1', 1, '', '', 0, 'local', '${T0}'),
                 ('conflict-v', 'n1', 1, '', '', 1, 'conflict', '${T0}');
      `);
      await applyChanges(db, [change('note', 'n1', null, 'delete')]);

      expect(await db.getFirstAsync(`SELECT * FROM notes WHERE id = 'n1'`)).toBeNull();
      expect(await db.getAllAsync(`SELECT * FROM note_tags`)).toEqual([]);
      expect(await db.getAllAsync(`SELECT * FROM note_links`)).toEqual([
        { source_note_id: 'other', target_title_norm: 'purged', target_note_id: null },
      ]);
      const versions = await db.getAllAsync<{ id: string }>(`SELECT id FROM note_versions_local`);
      expect(versions).toEqual([{ id: 'conflict-v' }]);
    });

    it('does nothing for an upsert without data', async () => {
      await cleanNote('n1', 'Kept');
      await applyChanges(db, [change('note', 'n1', null)]);
      expect((await noteRow('n1')).title).toBe('Kept');
    });
  });

  describe('collections', () => {
    const collection = (id: string) =>
      db.getFirstAsync<CollectionRow>(`SELECT * FROM collections WHERE id = ?`, [id]);
    const dto = (over: Partial<CollectionDto> = {}): CollectionDto => ({
      id: 'c1',
      parentId: null,
      name: 'Work',
      icon: 'briefcase',
      sortOrder: 2,
      noteCount: 0,
      serverRev: 3,
      createdAt: T0,
      updatedAt: T1,
      ...over,
    });
    async function insertCollection(id: string, parentId: string | null, dirty = 0) {
      await db.runAsync(
        `INSERT INTO collections (id, parent_id, name, dirty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, parentId, id, dirty, T0, T0],
      );
    }

    it('upserts and revives a collection', async () => {
      await insertCollection('c1', null);
      await db.runAsync(`UPDATE collections SET deleted_at = ? WHERE id = 'c1'`, [T0]);
      const rep = await applyChanges(db, [change('collection', 'c1', dto())]);
      expect(await collection('c1')).toMatchObject({
        name: 'Work',
        icon: 'briefcase',
        sort_order: 2,
        server_rev: 3,
        dirty: 0,
        deleted_at: null,
      });
      expect(touched(rep)).toEqual(['collections']);
    });

    it('skips a dirty collection', async () => {
      await insertCollection('c1', null, 1);
      const rep = await applyChanges(db, [change('collection', 'c1', dto())]);
      expect((await collection('c1'))!.name).toBe('c1');
      expect(touched(rep)).toEqual([]);
    });

    it('moves clean notes and children to the parent on delete (BR-08)', async () => {
      await insertCollection('root', null);
      await insertCollection('c1', 'root');
      await insertCollection('child', 'c1');
      await insertCollection('dirtyChild', 'c1', 1);
      await cleanNote('clean', 'Clean', { collection_id: 'c1' });
      await cleanNote('dirty', 'Dirty', { collection_id: 'c1', dirty: 1 });

      const rep = await applyChanges(db, [change('collection', 'c1', null, 'delete')]);

      expect((await collection('c1'))!.deleted_at).not.toBeNull();
      expect((await collection('child'))!.parent_id).toBe('root');
      expect((await collection('dirtyChild'))!.parent_id).toBe('c1');
      expect((await noteRow('clean')).collection_id).toBe('root');
      expect((await noteRow('dirty')).collection_id).toBe('c1');
      expect(touched(rep)).toEqual(['collections', 'notes']);
    });

    it('treats an upsert carrying deletedAt as a delete', async () => {
      await insertCollection('c1', null);
      await applyChanges(db, [
        change('collection', 'c1', { ...dto(), deletedAt: T2 } as CollectionDto),
      ]);
      expect((await collection('c1'))!.deleted_at).not.toBeNull();
    });

    it('ignores a delete for a collection it never had', async () => {
      const rep = await applyChanges(db, [change('collection', 'nope', null, 'delete')]);
      expect(await collection('nope')).toBeNull();
      expect(touched(rep)).toEqual(['collections']);
    });
  });

  describe('tags', () => {
    const tag = (id: string) =>
      db.getFirstAsync<TagRow>(`SELECT * FROM tags WHERE id = ?`, [id]) as Promise<TagRow>;
    const dto = (over: Partial<TagDto> = {}): TagDto => ({
      id: 't1',
      name: 'Work',
      colour: '#f00',
      noteCount: 0,
      serverRev: 2,
      ...over,
    });

    it('upserts a tag with a normalised name', async () => {
      await applyChanges(db, [change('tag', 't1', dto())]);
      expect(await tag('t1')).toMatchObject({
        name: 'Work',
        name_norm: 'work',
        colour: '#f00',
        server_rev: 2,
        dirty: 0,
      });
      await applyChanges(db, [change('tag', 't1', dto({ name: 'Job', serverRev: 3 }))]);
      expect(await tag('t1')).toMatchObject({ name: 'Job', server_rev: 3 });
    });

    it('skips a dirty tag', async () => {
      const id = await r.tags.save({ name: 'Local' });
      await applyChanges(db, [change('tag', id, dto({ id, name: 'Server' }))]);
      expect((await tag(id)).name).toBe('Local');
    });

    it('deletes a tag and its clean memberships, keeping unsent ones', async () => {
      await applyChanges(db, [change('tag', 't1', dto())]);
      await db.execAsync(`
        INSERT INTO note_tags (note_id, tag_id, created_at, dirty) VALUES ('n1', 't1', '${T0}', 0);
        INSERT INTO note_tags (note_id, tag_id, created_at, dirty) VALUES ('n2', 't1', '${T0}', 1);
      `);
      const rep = await applyChanges(db, [change('tag', 't1', null, 'delete')]);
      expect((await tag('t1')).deleted_at).not.toBeNull();
      const rows = await db.getAllAsync<NoteTagRow>(`SELECT * FROM note_tags ORDER BY note_id`);
      expect(rows[0]!.deleted_at).not.toBeNull();
      expect(rows[1]!.deleted_at).toBeNull();
      expect(touched(rep)).toEqual(['note_tags', 'tags']);
    });

    it('treats an upsert carrying deletedAt as a delete', async () => {
      await applyChanges(db, [change('tag', 't1', dto())]);
      await applyChanges(db, [change('tag', 't1', { ...dto(), deletedAt: T2 } as TagDto)]);
      expect((await tag('t1')).deleted_at).not.toBeNull();
    });
  });

  describe('note_tag memberships (set-merge, BR-10)', () => {
    const membership = () =>
      db.getFirstAsync<NoteTagRow>(`SELECT * FROM note_tags WHERE note_id = 'n1'`);
    const local = (createdAt: string, deletedAt: string | null) =>
      db.runAsync(
        `INSERT INTO note_tags (note_id, tag_id, created_at, deleted_at, dirty) VALUES ('n1', 't1', ?, ?, 1)`,
        [createdAt, deletedAt],
      );

    it('inserts a server membership', async () => {
      const rep = await applyChanges(db, [
        change('note_tag', 'n1:t1', { createdAt: T1, deletedAt: null }),
      ]);
      expect(await membership()).toMatchObject({ created_at: T1, deleted_at: null, dirty: 0 });
      expect(touched(rep)).toEqual(['note_tags']);
    });

    it('keeps a newer unsent local change', async () => {
      await local(T2, null);
      const rep = await applyChanges(db, [
        change('note_tag', 'n1:t1', { createdAt: T1, deletedAt: null }),
      ]);
      expect(await membership()).toMatchObject({ created_at: T2, dirty: 1 });
      expect(touched(rep)).toEqual([]);
    });

    it('lets a newer server change win over an older local one', async () => {
      // The local removal (T1) is older than the server's re-add (T2).
      await local(T0, T1);
      await applyChanges(db, [change('note_tag', 'n1:t1', { createdAt: T2, deletedAt: null })]);
      expect(await membership()).toMatchObject({ created_at: T2, deleted_at: null, dirty: 0 });
    });

    it('treats a membership without data as removed now', async () => {
      await local(T0, null);
      await applyChanges(db, [change('note_tag', 'n1:t1', null, 'delete')]);
      const row = await membership();
      expect(row!.deleted_at).not.toBeNull();
      expect(row!.dirty).toBe(0);
    });
  });

  describe('attachments', () => {
    const attachment = (id: string) =>
      db.getFirstAsync<AttachmentRow>(`SELECT * FROM attachments WHERE id = ?`, [id]);
    const dto = (over: Partial<AttachmentDto> = {}): AttachmentDto => ({
      id: 'a1',
      noteId: 'n1',
      filename: 'cat.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      sha256: 'abc',
      status: 'uploaded',
      width: 10,
      height: 20,
      serverRev: 1,
      createdAt: T0,
      updatedAt: T1,
      ...over,
    });

    it('upserts an attachment', async () => {
      const rep = await applyChanges(db, [change('attachment', 'a1', dto())]);
      expect(await attachment('a1')).toMatchObject({
        note_id: 'n1',
        filename: 'cat.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        status: 'uploaded',
        width: 10,
        height: 20,
        dirty: 0,
      });
      expect(touched(rep)).toEqual(['attachments']);
      await applyChanges(db, [change('attachment', 'a1', dto({ filename: 'dog.png' }))]);
      expect((await attachment('a1'))!.filename).toBe('dog.png');
    });

    it('marks a deleted attachment', async () => {
      await applyChanges(db, [change('attachment', 'a1', dto())]);
      await applyChanges(db, [change('attachment', 'a1', null, 'delete')]);
      expect((await attachment('a1'))!.deleted_at).not.toBeNull();
    });

    it('skips a dirty attachment', async () => {
      await applyChanges(db, [change('attachment', 'a1', dto())]);
      await db.runAsync(`UPDATE attachments SET dirty = 1`);
      const rep = await applyChanges(db, [change('attachment', 'a1', null, 'delete')]);
      expect((await attachment('a1'))!.deleted_at).toBeNull();
      expect(touched(rep)).toEqual([]);
    });
  });
});

describe('mergeReports', () => {
  it('unions touched tables and concatenates errors', () => {
    const e1 = { code: 'A', message: 'a', entity: 'note.upsert' };
    const e2 = { code: 'B', message: 'b', entity: 'tag.upsert' };
    const merged = mergeReports(
      { touched: new Set(['notes', 'outbox']), errors: [e1] },
      { touched: new Set(['outbox', 'tags']), errors: [e2] },
    );
    expect(touched(merged)).toEqual(['notes', 'outbox', 'tags']);
    expect(merged.errors).toEqual([e1, e2]);
  });

  it('returns an empty report for no input', () => {
    expect(touched(mergeReports())).toEqual([]);
  });
});
