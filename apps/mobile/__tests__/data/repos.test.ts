import {
  CollectionPlacementError,
  createRepos,
  DuplicateTagError,
  ftsQuery,
  LOCAL_VERSIONS_PER_NOTE,
  type Repos,
} from '../../src/data/repos';
import type { SqlDb } from '../../src/infra/sql';
import { createTestDb } from '../../src/test/nodeSqlite';

let db: SqlDb;
let r: Repos;

beforeEach(async () => {
  db = await createTestDb();
  r = createRepos(() => db);
});

describe('NotesRepo.save', () => {
  it('creates a dirty note with derived fields and one outbox upsert', async () => {
    const note = await r.notes.save({
      title: 'Kalman filtering',
      bodyMd: '# Kalman\n\nThe **filter** works.',
    });
    expect(note).toMatchObject({
      title: 'Kalman filtering',
      excerpt: 'Kalman The filter works.',
      wordCount: 4,
      serverRev: 0,
      localRev: 1,
      dirty: true,
    });
    const ops = await r.outbox.takeBatch(db);
    expect(ops).toEqual([
      expect.objectContaining({ type: 'note.upsert', entityId: note.id, baseRev: 0 }),
    ]);
  });

  it('coalesces repeated edits into one op that keeps the original base revision', async () => {
    const n = await r.notes.save({ title: 'Draft', bodyMd: 'one' });
    await db.runAsync(`UPDATE notes SET server_rev = 3`);
    await db.runAsync(`UPDATE outbox SET base_rev = 3`);
    await r.notes.save({ id: n.id, title: 'Draft', bodyMd: 'two' });
    await r.notes.save({ id: n.id, title: 'Draft', bodyMd: 'three' });
    const rows = await r.outbox.all(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.base_rev).toBe(3);
    expect(JSON.parse(rows[0]!.payload).bodyMd).toBe('three');
    expect((await r.notes.get(n.id))!.localRev).toBe(3);
  });

  it('never modifies ops already in flight', async () => {
    const n = await r.notes.save({ title: 'A', bodyMd: 'v1' });
    await r.outbox.takeBatch(db);
    await r.notes.save({ id: n.id, title: 'A', bodyMd: 'v2' });
    const rows = await r.outbox.all(db);
    expect(rows.map((x) => [x.status, JSON.parse(x.payload).bodyMd])).toEqual([
      ['inflight', 'v1'],
      ['pending', 'v2'],
    ]);
  });

  it('keeps the last 10 local versions', async () => {
    const n = await r.notes.save({ title: 'V', bodyMd: 'v0' });
    for (let i = 1; i <= 14; i++) await r.notes.save({ id: n.id, title: 'V', bodyMd: `v${i}` });
    const versions = await r.versions.local(n.id);
    expect(versions).toHaveLength(LOCAL_VERSIONS_PER_NOTE);
    expect(versions[0]!.body_md).toBe('v14');
  });

  it('cancels create-then-delete of a note the server never saw', async () => {
    const n = await r.notes.save({ title: 'Oops', bodyMd: '' });
    await r.notes.trashNote(n.id);
    expect(await r.outbox.all(db)).toEqual([]);
    expect((await r.notes.trash()).map((x) => x.id)).toEqual([n.id]);
  });

  it('queues a delete with the base revision for a synced note, and restores', async () => {
    const n = await r.notes.save({ title: 'Synced', bodyMd: '' });
    await db.runAsync(`DELETE FROM outbox`);
    await db.runAsync(`UPDATE notes SET server_rev = 2, dirty = 0`);
    await r.notes.trashNote(n.id);
    expect((await r.outbox.takeBatch(db))[0]).toMatchObject({
      type: 'note.delete',
      entityId: n.id,
      baseRev: 2,
    });
    await r.notes.restore(n.id);
    expect((await r.notes.get(n.id))!.deletedAt).toBeNull();
    expect((await r.notes.list()).map((x) => x.id)).toEqual([n.id]);
  });

  it('lists pinned first, then most recent, with filters', async () => {
    await r.notes.save({ title: 'A', bodyMd: '' });
    const b = await r.notes.save({ title: 'B', bodyMd: '', isPinned: true });
    await r.notes.save({ title: 'C', bodyMd: '' });
    expect((await r.notes.list()).map((n) => n.title)).toEqual(['B', 'C', 'A']);
    expect((await r.notes.list({ pinned: true })).map((n) => n.id)).toEqual([b.id]);
  });
});

describe('links, autocomplete and search', () => {
  it('resolves links to existing notes, and ghost links when the target appears', async () => {
    const target = await r.notes.save({ title: 'State estimation', bodyMd: '' });
    const source = await r.notes.save({
      title: 'Kalman',
      bodyMd: 'Builds on [[State  Estimation]] and [[Sensor fusion]].',
    });
    const links = () =>
      db.getAllAsync<{ target_title_norm: string; target_note_id: string | null }>(
        `SELECT target_title_norm, target_note_id FROM note_links WHERE source_note_id = ? ORDER BY 1`,
        [source.id],
      );
    expect(await links()).toEqual([
      { target_title_norm: 'sensor fusion', target_note_id: null },
      { target_title_norm: 'state estimation', target_note_id: target.id },
    ]);
    const fusion = await r.notes.save({ title: 'Sensor Fusion', bodyMd: '' });
    expect((await links())[0]).toEqual({
      target_title_norm: 'sensor fusion',
      target_note_id: fusion.id,
    });

    expect(await r.links.backlinks(target.id)).toEqual([
      {
        noteId: source.id,
        title: 'Kalman',
        context: 'Builds on [[State Estimation]] and [[Sensor fusion]].',
      },
    ]);
  });

  it('autocompletes titles by prefix and searches with ranked snippets', async () => {
    await r.notes.save({
      title: 'Kalman filtering',
      bodyMd: 'Estimates hidden state from noisy data.',
    });
    await r.notes.save({
      title: 'Particle filters',
      bodyMd: 'Unlike the Kalman filter, uses samples.',
    });
    await r.notes.save({ title: 'Karaoke night', bodyMd: '' });
    expect((await r.links.autocomplete('Kal')).map((x) => x.title)).toEqual(['Kalman filtering']);
    expect((await r.links.autocomplete('ka')).map((x) => x.title).sort()).toEqual([
      'Kalman filtering',
      'Karaoke night',
    ]);

    const hits = await r.links.search('kalman');
    expect(hits.map((h) => h.title)).toEqual(['Kalman filtering', 'Particle filters']);
    expect(hits[1]!.snippet).toContain('«Kalman»');
    // FTS syntax is matched as text, never a query error.
    for (const q of ['kalman AND (', '"', 'NEAR(', '*', 'title:']) {
      await expect(r.links.search(q)).resolves.toBeDefined();
    }
    expect(ftsQuery('  ')).toBeNull();
  });

  it('drops trashed notes from search and backlinks', async () => {
    const t = await r.notes.save({ title: 'Target', bodyMd: '' });
    const s = await r.notes.save({ title: 'Source', bodyMd: 'See [[Target]]. Kalman' });
    await r.notes.trashNote(s.id);
    expect(await r.links.search('kalman')).toEqual([]);
    expect(await r.links.backlinks(t.id)).toEqual([]);
  });
});

describe('tags', () => {
  it('refuses case-insensitive duplicates and counts live notes', async () => {
    const thesis = await r.tags.save({ name: 'Thesis' });
    await expect(r.tags.save({ name: 'thesis' })).rejects.toBeInstanceOf(DuplicateTagError);
    const n = await r.notes.save({ title: 'n', bodyMd: '' });
    await r.tags.setMembership(n.id, thesis, true);
    expect((await r.tags.list())[0]).toMatchObject({ name: 'Thesis', noteCount: 1 });
    expect((await r.tags.forNote(n.id)).map((t) => t.name)).toEqual(['Thesis']);
  });

  it('cancels an add followed by a remove made offline', async () => {
    const tag = await r.tags.save({ name: 'x' });
    const n = await r.notes.save({ title: 'n', bodyMd: '' });
    await db.runAsync(`DELETE FROM outbox`);
    await r.tags.setMembership(n.id, tag, true);
    await r.tags.setMembership(n.id, tag, true);
    expect((await r.outbox.all(db)).map((o) => o.op)).toEqual(['add']);
    await r.tags.setMembership(n.id, tag, false);
    expect(await r.outbox.all(db)).toEqual([]);
  });

  it('produces note_tag ops in the sync shape', async () => {
    const tag = await r.tags.save({ name: 'y' });
    const n = await r.notes.save({ title: 'n', bodyMd: '' });
    await r.tags.setMembership(n.id, tag, true);
    const ops = await r.outbox.takeBatch(db);
    expect(ops.at(-1)).toEqual({
      opId: expect.any(String),
      createdAt: expect.any(String),
      type: 'note_tag.add',
      noteId: n.id,
      tagId: tag,
    });
  });
});

describe('collections', () => {
  it('enforces depth 6 and refuses cycles', async () => {
    let parent: string | null = null;
    const chain: string[] = [];
    for (let i = 1; i <= 6; i++) {
      parent = await r.collections.save({ name: `L${i}`, parentId: parent });
      chain.push(parent);
    }
    await expect(r.collections.save({ name: 'L7', parentId: parent })).rejects.toMatchObject({
      code: 'DEPTH_EXCEEDED',
    });
    await expect(
      r.collections.save({ id: chain[0]!, name: 'L1', parentId: chain[2]! }),
    ).rejects.toBeInstanceOf(CollectionPlacementError);
  });

  it('moves notes and children to the parent on delete (BR-08)', async () => {
    const root = await r.collections.save({ name: 'Root' });
    const mid = await r.collections.save({ name: 'Mid', parentId: root });
    const leaf = await r.collections.save({ name: 'Leaf', parentId: mid });
    const n = await r.notes.save({ title: 'in mid', bodyMd: '', collectionId: mid });
    await r.collections.remove(mid);
    expect((await r.notes.get(n.id))!.collectionId).toBe(root);
    const list = await r.collections.list();
    expect(list.find((c) => c.id === leaf)!.parentId).toBe(root);
    expect(list.map((c) => c.name).sort()).toEqual(['Leaf', 'Root']);
  });
});

describe('outbox batches', () => {
  it('splits by count and byte size, in order, and releases on failure', async () => {
    for (let i = 0; i < 5; i++) await r.notes.save({ title: `n${i}`, bodyMd: 'x'.repeat(1000) });
    const first = await r.outbox.takeBatch(db, 3);
    expect(first).toHaveLength(3);
    await r.outbox.remove(
      db,
      first.map((o) => o.opId),
    );
    expect(await r.outbox.takeBatch(db, 100, 1500)).toHaveLength(1);
    await r.outbox.release(db, 'offline');
    expect(await r.outbox.pendingCount(db)).toBe(2);
  });
});
