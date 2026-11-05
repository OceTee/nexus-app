import {
  BacklinkDto,
  CollectionDto,
  CollectionListDto,
  GraphDto,
  ItemList,
  NoteDto,
  NoteSummaryDto,
  NoteVersionDetailDto,
  NoteVersionDto,
  OutgoingLinkDto,
  Paginated,
  SearchHitDto,
  TagDto,
  TagListDto,
  TrashedNoteDto,
} from '@nexus/shared';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  closePools,
  expectError,
  expectShape,
  makeApp,
  openPools,
  verifiedUser,
  type Pools,
  type TestApp,
} from '../helpers/testApp';

let pools: Pools;
beforeAll(() => {
  pools = openPools();
});
afterAll(() => closePools(pools));

type U = Awaited<ReturnType<typeof verifiedUser>>;

async function createNote(
  t: TestApp,
  u: U,
  title: string,
  bodyMd = '',
  extra: Record<string, unknown> = {},
) {
  const res = await t.http
    .post('/v1/notes')
    .set(bearer(u.accessToken))
    .send({ id: uuidv7(), title, bodyMd, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return expectShape(NoteDto, res.body);
}

describe('notes REST', () => {
  it('creates, reads, patches only the given fields, and lists with filters and pages', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const note = await createNote(
      t,
      u,
      'Kalman filtering',
      '# Kalman\n\nSee [[State estimation]].',
      { isPinned: true },
    );
    expect(note).toMatchObject({
      serverRev: 1,
      wordCount: 4,
      excerpt: 'Kalman See State estimation.',
    });
    expectError(
      await t.http
        .post('/v1/notes')
        .set(bearer(u.accessToken))
        .send({ id: note.id, title: 'again' }),
      409,
      'DUPLICATE',
    );

    // Regression: a title-only PATCH must not reset the body or the pin.
    const patched = await t.http
      .patch(`/v1/notes/${note.id}`)
      .set(bearer(u.accessToken))
      .send({ title: 'Kalman filter', baseRev: 1 });
    expect(expectShape(NoteDto, patched.body)).toMatchObject({
      title: 'Kalman filter',
      bodyMd: note.bodyMd,
      isPinned: true,
      serverRev: 2,
    });

    for (let i = 0; i < 4; i++) await createNote(t, u, `Other ${i}`);
    const page1 = expectShape(
      Paginated(NoteSummaryDto),
      (await t.http.get('/v1/notes?limit=2').set(bearer(u.accessToken))).body,
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]).not.toHaveProperty('bodyMd');
    const page2 = await t.http
      .get(`/v1/notes?limit=10&cursor=${page1.nextCursor}`)
      .set(bearer(u.accessToken));
    expect(page2.body.items).toHaveLength(3);
    const ids = [...page1.items, ...page2.body.items].map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(5);

    const pinned = await t.http.get('/v1/notes?pinned=true').set(bearer(u.accessToken));
    expect(pinned.body.items.map((n: { id: string }) => n.id)).toEqual([note.id]);
  });

  it('trashes, lists trash with purge dates, and restores', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const note = await createNote(t, u, 'Temporary');
    await t.http
      .delete(`/v1/notes/${note.id}`)
      .set(bearer(u.accessToken))
      .send({ baseRev: 1 })
      .expect(204);
    expect((await t.http.get('/v1/notes').set(bearer(u.accessToken))).body.items).toEqual([]);
    const trash = expectShape(
      Paginated(TrashedNoteDto),
      (await t.http.get('/v1/notes/trash').set(bearer(u.accessToken))).body,
    );
    expect(Date.parse(trash.items[0]!.purgeAt) - Date.parse(trash.items[0]!.deletedAt)).toBe(
      30 * 86_400_000,
    );
    const restored = await t.http.post(`/v1/notes/${note.id}/restore`).set(bearer(u.accessToken));
    expect(expectShape(NoteDto, restored.body)).toMatchObject({ deletedAt: null, serverRev: 3 });
  });

  it('lists versions, restores one as a new revision', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const note = await createNote(t, u, 'Drafts', 'first');
    await t.http
      .patch(`/v1/notes/${note.id}`)
      .set(bearer(u.accessToken))
      .send({ bodyMd: 'second', baseRev: 1 });
    const list = expectShape(
      Paginated(NoteVersionDto),
      (await t.http.get(`/v1/notes/${note.id}/versions`).set(bearer(u.accessToken))).body,
    );
    expect(list.items.map((v) => v.rev)).toEqual([2, 1]);
    expect(list.items[0]!.deviceName).toBe('Pixel 7');
    const first = list.items[1]!;
    const detail = expectShape(
      NoteVersionDetailDto,
      (await t.http.get(`/v1/notes/${note.id}/versions/${first.id}`).set(bearer(u.accessToken)))
        .body,
    );
    expect(detail.bodyMd).toBe('first');
    const restored = await t.http
      .post(`/v1/notes/${note.id}/versions/${first.id}/restore`)
      .set(bearer(u.accessToken))
      .send({ baseRev: 2 });
    expect(restored.body).toMatchObject({ bodyMd: 'first', serverRev: 3 });
  });

  it('lists and resolves conflicts (merged)', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const note = await createNote(t, u, 'Contested', 'base');
    await t.http
      .patch(`/v1/notes/${note.id}`)
      .set(bearer(u.accessToken))
      .send({ bodyMd: 'server', baseRev: 1 });
    const conflict = await t.http
      .patch(`/v1/notes/${note.id}`)
      .set(bearer(u.accessToken))
      .send({ bodyMd: 'mine', baseRev: 1 });
    const versionId = conflict.body.error.details.conflictVersionId;
    const open = await t.http.get(`/v1/notes/${note.id}/conflicts`).set(bearer(u.accessToken));
    expect(open.body.items).toEqual([expect.objectContaining({ versionId, serverRev: 2 })]);

    expectError(
      await t.http
        .post(`/v1/notes/${note.id}/conflicts/${versionId}/resolve`)
        .set(bearer(u.accessToken))
        .send({ strategy: 'merged', baseRev: 1, bodyMd: 'x' }),
      409,
      'CONFLICT',
    );
    const resolved = await t.http
      .post(`/v1/notes/${note.id}/conflicts/${versionId}/resolve`)
      .set(bearer(u.accessToken))
      .send({ strategy: 'merged', baseRev: 2, bodyMd: 'server + mine' });
    expect(resolved.body).toMatchObject({ bodyMd: 'server + mine', serverRev: 3 });
    expect(
      (await t.http.get(`/v1/notes/${note.id}/conflicts`).set(bearer(u.accessToken))).body.items,
    ).toEqual([]);
    expectError(
      await t.http
        .post(`/v1/notes/${note.id}/conflicts/${versionId}/resolve`)
        .set(bearer(u.accessToken))
        .send({ strategy: 'keep_server', baseRev: 3 }),
      404,
      'NOT_FOUND',
    );
  });

  it('manages note tags with PUT, POST and DELETE', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const note = await createNote(t, u, 'Tagged');
    const tag = async (name: string) =>
      expectShape(
        TagDto,
        (await t.http.post('/v1/tags').set(bearer(u.accessToken)).send({ id: uuidv7(), name }))
          .body,
      );
    const [a, b, c] = [await tag('a'), await tag('b'), await tag('c')];
    const put = await t.http
      .put(`/v1/notes/${note.id}/tags`)
      .set(bearer(u.accessToken))
      .send({ tagIds: [a.id, b.id] });
    expect([...put.body.tagIds].sort()).toEqual([a.id, b.id].sort());
    await t.http.post(`/v1/notes/${note.id}/tags/${c.id}`).set(bearer(u.accessToken)).expect(200);
    const del = await t.http.delete(`/v1/notes/${note.id}/tags/${a.id}`).set(bearer(u.accessToken));
    expect([...del.body.tagIds].sort()).toEqual([b.id, c.id].sort());
    expectError(
      await t.http.post(`/v1/notes/${note.id}/tags/${uuidv7()}`).set(bearer(u.accessToken)),
      404,
      'NOT_FOUND',
    );
  });
});

describe('T-24 links and backlinks', () => {
  it('resolves a ghost link when its target is created and shows backlink context', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const a = await createNote(t, u, 'A', 'Intro. A depends on [[B  note]] for state. End.');
    const ghost = expectShape(
      ItemList(OutgoingLinkDto),
      (await t.http.get(`/v1/notes/${a.id}/links`).set(bearer(u.accessToken))).body,
    );
    expect(ghost.items).toEqual([{ targetTitle: 'B note', targetNoteId: null }]);

    const b = await createNote(t, u, 'B note');
    const resolved = await t.http.get(`/v1/notes/${a.id}/links`).set(bearer(u.accessToken));
    expect(resolved.body.items[0].targetNoteId).toBe(b.id);

    const back = expectShape(
      ItemList(BacklinkDto),
      (await t.http.get(`/v1/notes/${b.id}/backlinks`).set(bearer(u.accessToken))).body,
    );
    expect(back.items).toEqual([
      { noteId: a.id, title: 'A', context: 'A depends on [[B note]] for state.' },
    ]);

    await t.http
      .delete(`/v1/notes/${b.id}`)
      .set(bearer(u.accessToken))
      .send({ baseRev: 1 })
      .expect(204);
    expect(
      (await t.http.get(`/v1/notes/${a.id}/links`).set(bearer(u.accessToken))).body.items[0]
        .targetNoteId,
    ).toBeNull();
  });
});

describe('collections', () => {
  it('T-23: nests to depth 6, refuses the 7th and cycles', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    let parentId: string | null = null;
    const chain: string[] = [];
    for (let depth = 1; depth <= 7; depth++) {
      const id = uuidv7();
      const res = await t.http
        .post('/v1/collections')
        .set(bearer(u.accessToken))
        .send({ id, parentId, name: `Level ${depth}` });
      if (depth <= 6) {
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        chain.push(id);
        parentId = id;
      } else {
        expectError(res, 422, 'DEPTH_EXCEEDED');
      }
    }
    expectError(
      await t.http
        .post(`/v1/collections/${chain[0]}/move`)
        .set(bearer(u.accessToken))
        .send({ parentId: chain[3] }),
      422,
      'CYCLE',
    );
  });

  it('lists with counts, renames, and on delete moves notes and children to the parent (BR-08)', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const make = async (name: string, parentId: string | null = null) =>
      expectShape(
        CollectionDto,
        (
          await t.http
            .post('/v1/collections')
            .set(bearer(u.accessToken))
            .send({ id: uuidv7(), parentId, name })
        ).body,
      );
    const research = await make('Research');
    const thesis = await make('Thesis', research.id);
    const chapter = await make('Chapter 2', thesis.id);
    const note = await createNote(t, u, 'In thesis', '', { collectionId: thesis.id });

    const list = expectShape(
      CollectionListDto,
      (await t.http.get('/v1/collections').set(bearer(u.accessToken))).body,
    );
    expect(list.items.find((c) => c.id === thesis.id)?.noteCount).toBe(1);

    const renamed = await t.http
      .patch(`/v1/collections/${thesis.id}`)
      .set(bearer(u.accessToken))
      .send({ name: 'My thesis', baseRev: 1 });
    expect(renamed.body).toMatchObject({ name: 'My thesis', serverRev: 2 });
    expectError(
      await t.http
        .patch(`/v1/collections/${thesis.id}`)
        .set(bearer(u.accessToken))
        .send({ name: 'Stale rename', baseRev: 1 }),
      409,
      'CONFLICT',
    );

    await t.http
      .delete(`/v1/collections/${thesis.id}`)
      .set(bearer(u.accessToken))
      .send({ baseRev: 2 })
      .expect(204);
    expect(
      (await t.http.get(`/v1/notes/${note.id}`).set(bearer(u.accessToken))).body.collectionId,
    ).toBe(research.id);
    expect(
      (await t.http.get(`/v1/collections/${chapter.id}`).set(bearer(u.accessToken))).body.parentId,
    ).toBe(research.id);
    expectError(
      await t.http.get(`/v1/collections/${uuidv7()}`).set(bearer(u.accessToken)),
      404,
      'NOT_FOUND',
    );
  });
});

describe('tags', () => {
  it('lists with counts, refuses case-insensitive duplicates, renames and merges', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const thesis = expectShape(
      TagDto,
      (
        await t.http
          .post('/v1/tags')
          .set(bearer(u.accessToken))
          .send({ id: uuidv7(), name: 'Thesis', colour: '#3B5BDB' })
      ).body,
    );
    expectError(
      await t.http
        .post('/v1/tags')
        .set(bearer(u.accessToken))
        .send({ id: uuidv7(), name: 'thesis' }),
      409,
      'DUPLICATE',
    );
    const reading = expectShape(
      TagDto,
      (
        await t.http
          .post('/v1/tags')
          .set(bearer(u.accessToken))
          .send({ id: uuidv7(), name: 'reading' })
      ).body,
    );
    const n1 = await createNote(t, u, 'one', '', { tagIds: [thesis.id] });
    await createNote(t, u, 'two', '', { tagIds: [reading.id] });
    await createNote(t, u, 'three', '', { tagIds: [thesis.id, reading.id] });

    const list = expectShape(
      TagListDto,
      (await t.http.get('/v1/tags').set(bearer(u.accessToken))).body,
    );
    expect(list.items.map((x) => [x.name, x.noteCount])).toEqual([
      ['reading', 2],
      ['Thesis', 2],
    ]);

    expectError(
      await t.http
        .patch(`/v1/tags/${reading.id}`)
        .set(bearer(u.accessToken))
        .send({ name: 'THESIS', baseRev: 1 }),
      409,
      'DUPLICATE',
    );
    const merged = await t.http
      .post(`/v1/tags/${reading.id}/merge`)
      .set(bearer(u.accessToken))
      .send({ targetTagId: thesis.id });
    expect(merged.body).toEqual({ movedNotes: 1 });
    const after = await t.http.get('/v1/tags').set(bearer(u.accessToken));
    expect(
      after.body.items.map((x: { name: string; noteCount: number }) => [x.name, x.noteCount]),
    ).toEqual([['Thesis', 3]]);
    expect((await t.http.get(`/v1/notes/${n1.id}`).set(bearer(u.accessToken))).body.tagIds).toEqual(
      [thesis.id],
    );
  });
});

describe('graph and search', () => {
  it('builds the graph with link edges, filters and neighbourhoods', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const tag = expectShape(
      TagDto,
      (
        await t.http
          .post('/v1/tags')
          .set(bearer(u.accessToken))
          .send({ id: uuidv7(), name: 'core' })
      ).body,
    );
    const hub = await createNote(t, u, 'Hub', 'Links [[Spoke one]] and [[Spoke two]].', {
      tagIds: [tag.id],
    });
    const s1 = await createNote(t, u, 'Spoke one', 'Back to [[Hub]] and on to [[Far]].');
    const s2 = await createNote(t, u, 'Spoke two');
    const far = await createNote(t, u, 'Far');
    await createNote(t, u, 'Orphan');

    const graph = expectShape(
      GraphDto,
      (await t.http.get('/v1/graph').set(bearer(u.accessToken))).body,
    );
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes[0]).toMatchObject({ id: hub.id, tagIds: [tag.id] });
    expect(graph.edges).toHaveLength(4);
    expect(graph.truncated).toBe(false);

    const noOrphans = await t.http.get('/v1/graph?orphans=false').set(bearer(u.accessToken));
    expect(noOrphans.body.nodes).toHaveLength(4);
    const tagged = await t.http.get(`/v1/graph?tagIds=${tag.id}`).set(bearer(u.accessToken));
    expect(tagged.body.nodes.map((n: { id: string }) => n.id)).toEqual([hub.id]);
    const capped = await t.http.get('/v1/graph?limit=2').set(bearer(u.accessToken));
    expect(capped.body).toMatchObject({ truncated: true });

    const one = await t.http
      .get(`/v1/graph/neighbours/${s2.id}?depth=1`)
      .set(bearer(u.accessToken));
    expect(one.body.nodes.map((n: { id: string }) => n.id).sort()).toEqual([hub.id, s2.id].sort());
    const two = await t.http
      .get(`/v1/graph/neighbours/${s2.id}?depth=2`)
      .set(bearer(u.accessToken));
    expect(two.body.nodes.map((n: { id: string }) => n.id).sort()).toEqual(
      [hub.id, s1.id, s2.id].sort(),
    );
    expect(two.body.nodes.map((n: { id: string }) => n.id)).not.toContain(far.id);
  });

  it('ranks matches with snippets, scopes to a collection subtree, and tolerates FTS syntax', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const root = expectShape(
      CollectionDto,
      (
        await t.http
          .post('/v1/collections')
          .set(bearer(u.accessToken))
          .send({ id: uuidv7(), name: 'Root' })
      ).body,
    );
    const child = expectShape(
      CollectionDto,
      (
        await t.http
          .post('/v1/collections')
          .set(bearer(u.accessToken))
          .send({ id: uuidv7(), name: 'Child', parentId: root.id })
      ).body,
    );
    await createNote(
      t,
      u,
      'Kalman filtering',
      'The Kalman filter estimates state from noisy measurements.',
      { collectionId: child.id },
    );
    await createNote(
      t,
      u,
      'Particle filters',
      'Monte Carlo state estimation, unlike the Kalman filter.',
    );
    await createNote(t, u, 'Recipe', 'Jollof rice.');

    const res = await t.http.get('/v1/search?q=kalman').set(bearer(u.accessToken));
    const hits = expectShape(Paginated(SearchHitDto), res.body);
    expect(hits.items.map((h) => h.title)).toEqual(['Kalman filtering', 'Particle filters']);
    expect(hits.items[0]!.snippet).toContain('**Kalman**');

    const scoped = await t.http
      .get(`/v1/search?q=kalman&collectionId=${root.id}`)
      .set(bearer(u.accessToken));
    expect(scoped.body.items.map((h: { title: string }) => h.title)).toEqual(['Kalman filtering']);

    const page1 = await t.http.get('/v1/search?q=kalman&limit=1').set(bearer(u.accessToken));
    const page2 = await t.http
      .get(`/v1/search?q=kalman&limit=1&cursor=${page1.body.nextCursor}`)
      .set(bearer(u.accessToken));
    expect([page1.body.items[0].title, page2.body.items[0].title]).toEqual([
      'Kalman filtering',
      'Particle filters',
    ]);
    expect(page2.body.hasMore).toBe(false);

    for (const q of ['kalman & | ! (', '"unclosed', '-', ':*']) {
      expect(
        (await t.http.get(`/v1/search?q=${encodeURIComponent(q)}`).set(bearer(u.accessToken)))
          .status,
      ).toBe(200);
    }
  });
});

describe('limits', () => {
  it('accepts a 150 KB note body (2 MB route limit) and refuses bodies over 2 MB with 413', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    await createNote(t, u, 'Big', 'word '.repeat(30_000));
    const res = await t.http
      .post('/v1/notes')
      .set(bearer(u.accessToken))
      .set('content-type', 'application/json')
      .send(JSON.stringify({ id: uuidv7(), title: 'Huge', bodyMd: 'x'.repeat(2_200_000) }));
    expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });
});
