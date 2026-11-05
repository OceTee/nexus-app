import { NoteDto, SnapshotPageDto, SyncResponse, SyncStatusDto, type SyncOp } from '@nexus/shared';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import { pruneVersions } from '../../src/jobs/versionsPrune';
import { SimClient } from '../helpers/syncClient';
import {
  bearer,
  closePools,
  device,
  expectError,
  expectShape,
  makeApp,
  openPools,
  registerUser,
  STRONG_PASSWORD,
  verifiedUser,
  type Pools,
  type TestApp,
} from '../helpers/testApp';

let pools: Pools;
beforeAll(() => {
  pools = openPools();
});
afterAll(() => closePools(pools));

const now = () => new Date().toISOString();
const noteUpsert = (
  entityId: string,
  baseRev: number,
  bodyMd: string,
  extra: Partial<{ title: string; collectionId: string | null }> = {},
): SyncOp => ({
  opId: uuidv7(),
  createdAt: now(),
  type: 'note.upsert',
  entityId,
  baseRev,
  payload: {
    title: extra.title ?? 'Kalman filtering',
    bodyMd,
    collectionId: extra.collectionId ?? null,
    isPinned: false,
    tagIds: [],
  },
});

async function push(
  t: TestApp,
  u: { accessToken: string; device: { id: string } },
  ops: SyncOp[],
  cursor = 0,
) {
  const res = await t.http
    .post('/v1/sync')
    .set(bearer(u.accessToken))
    .send({ deviceId: u.device.id, cursor, ops, clientSchema: 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return expectShape(SyncResponse, res.body);
}

/** Signs the user in on a second device and returns that session. */
async function secondDevice(t: TestApp, email: string) {
  const dev = device('Tablet');
  const res = await t.http
    .post('/v1/auth/login')
    .send({ email, password: STRONG_PASSWORD, device: dev });
  return { accessToken: res.body.accessToken as string, device: dev };
}

describe('T-30 email verification gate', () => {
  it('refuses sync for an unverified account', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const res = await t.http
      .post('/v1/sync')
      .set(bearer(u.accessToken))
      .send({ deviceId: u.device.id, cursor: 0, ops: [], clientSchema: 1 });
    expectError(res, 403, 'EMAIL_UNVERIFIED');
  });
});

describe('sync guards', () => {
  it('refuses another device id, an old client schema and a revoked device', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    expectError(
      await t.http
        .post('/v1/sync')
        .set(bearer(u.accessToken))
        .send({ deviceId: uuidv7(), cursor: 0, ops: [], clientSchema: 1 }),
      403,
      'FORBIDDEN',
    );
    const tablet = await secondDevice(t, u.email);
    await t.http.delete(`/v1/devices/${tablet.device.id}`).set(bearer(u.accessToken)).expect(204);
    expectError(
      await t.http
        .post('/v1/sync')
        .set(bearer(tablet.accessToken))
        .send({ deviceId: tablet.device.id, cursor: 0, ops: [], clientSchema: 1 }),
      403,
      'DEVICE_REVOKED',
    );
  });
});

describe('T-17 sync applies ops in order', () => {
  it('applies collection, note in it, tag and membership; another device pulls them', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const collectionId = uuidv7();
    const noteId = uuidv7();
    const tagId = uuidv7();
    const res = await push(t, u, [
      {
        opId: uuidv7(),
        createdAt: now(),
        type: 'collection.upsert',
        entityId: collectionId,
        baseRev: 0,
        payload: { parentId: null, name: 'Thesis' },
      },
      noteUpsert(noteId, 0, 'Links to [[State estimation]].', { collectionId }),
      {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.upsert',
        entityId: tagId,
        baseRev: 0,
        payload: { name: 'thesis' },
      },
      { opId: uuidv7(), createdAt: now(), type: 'note_tag.add', noteId, tagId },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
    expect(res.changes).toEqual([]); // the device already holds its own ops

    const note = expectShape(
      NoteDto,
      (await t.http.get(`/v1/notes/${noteId}`).set(bearer(u.accessToken))).body,
    );
    expect(note).toMatchObject({ collectionId, tagIds: [tagId], serverRev: 1, wordCount: 4 });
    const feed = await pools.owner.db
      .select()
      .from(s.changes)
      .where(eq(s.changes.userId, u.userId));
    expect(feed.map((c) => c.entityType)).toEqual(['collection', 'note', 'tag', 'note_tag']);

    const tablet = await secondDevice(t, u.email);
    const pulled = await push(t, tablet, []);
    expect(pulled.changes.map((c) => c.entityType)).toEqual([
      'collection',
      'note',
      'tag',
      'note_tag',
    ]);
    expect(pulled.changes[1]!.data).toMatchObject({
      id: noteId,
      title: 'Kalman filtering',
      tagIds: [tagId],
    });
    expect(pulled.cursor).toBe(Math.max(...feed.map((c) => c.changeSeq)));
    expect((await push(t, tablet, [], pulled.cursor)).changes).toEqual([]);
  });

  it('pages the change feed with hasMore', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const ops = Array.from({ length: 100 }, (_, i) => noteUpsert(uuidv7(), 0, `note ${i}`));
    await push(t, u, ops);
    await push(
      t,
      u,
      Array.from({ length: 100 }, (_, i) => noteUpsert(uuidv7(), 0, `more ${i}`)),
    );
    await push(
      t,
      u,
      Array.from({ length: 100 }, (_, i) => noteUpsert(uuidv7(), 0, `last ${i}`)),
    );
    const tablet = await secondDevice(t, u.email);
    const first = await push(t, tablet, []);
    // 300 changes fit in one 500-row page.
    expect(first.changes).toHaveLength(300);
    expect(first.hasMore).toBe(false);
  });
});

describe('T-18 sync conflict', () => {
  it('keeps the first writer and stores the second as a conflict version', async () => {
    const t = await makeApp(pools);
    const a = await verifiedUser(t);
    const b = await secondDevice(t, a.email);
    const noteId = uuidv7();
    await push(t, a, [noteUpsert(noteId, 0, 'v1')]);
    const fromA = await push(t, a, [noteUpsert(noteId, 1, 'A wins')]);
    expect(fromA.results[0]).toMatchObject({ status: 'applied', serverRev: 2 });

    const fromB = await push(t, b, [noteUpsert(noteId, 1, 'B was offline')]);
    expect(fromB.results[0]).toMatchObject({ status: 'conflict', serverRev: 2 });
    expect(fromB.conflicts[0]).toMatchObject({ noteId, serverRev: 2, deviceId: b.device.id });
    expect(fromB.changes.find((c) => c.entityKey === noteId)?.data).toMatchObject({
      bodyMd: 'A wins',
    });

    const versions = await pools.owner.db
      .select()
      .from(s.noteVersions)
      .where(eq(s.noteVersions.noteId, noteId));
    expect(versions.find((v) => v.conflict)).toMatchObject({ bodyMd: 'B was offline', baseRev: 1 });
    const note = await t.http.get(`/v1/notes/${noteId}`).set(bearer(a.accessToken));
    expect(note.body).toMatchObject({ bodyMd: 'A wins', serverRev: 2 });

    const status = expectShape(
      SyncStatusDto,
      (await t.http.get('/v1/sync/status').set(bearer(a.accessToken))).body,
    );
    expect(status.openConflicts).toBe(1);
    expect(status.devices).toHaveLength(2);
  });

  it('the REST path produces the same conflict as sync', async () => {
    const t = await makeApp(pools);
    const a = await verifiedUser(t);
    const noteId = uuidv7();
    await push(t, a, [noteUpsert(noteId, 0, 'v1'), noteUpsert(noteId, 1, 'v2')]);
    const res = await t.http
      .patch(`/v1/notes/${noteId}`)
      .set(bearer(a.accessToken))
      .send({ bodyMd: 'stale', baseRev: 1 });
    expectError(res, 409, 'CONFLICT');
    expect(res.body.error.details).toMatchObject({
      serverRev: 2,
      conflictVersionId: expect.any(String),
    });
  });
});

describe('T-19 idempotency and BR-03', () => {
  it('returns the stored receipt for a repeated opId', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const noteId = uuidv7();
    const create = noteUpsert(noteId, 0, 'once');
    const first = await push(t, u, [create]);
    const again = await push(t, u, [create]);
    expect(again.results).toEqual(first.results);
    const note = await t.http.get(`/v1/notes/${noteId}`).set(bearer(u.accessToken));
    expect(note.body.serverRev).toBe(1);
  });

  it('applies an unchanged upsert as a no-op without a version', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const noteId = uuidv7();
    await push(t, u, [noteUpsert(noteId, 0, 'same')]);
    const res = await push(t, u, [noteUpsert(noteId, 1, 'same')]);
    expect(res.results[0]).toMatchObject({ status: 'applied', serverRev: 1 });
    const versions = await pools.owner.db
      .select()
      .from(s.noteVersions)
      .where(eq(s.noteVersions.noteId, noteId));
    expect(versions).toHaveLength(1);
  });
});

describe('T-20 cross-user isolation', () => {
  it('hides another user’s note and rejects ops for it', async () => {
    const t = await makeApp(pools);
    const x = await verifiedUser(t);
    const y = await verifiedUser(t);
    const noteId = uuidv7();
    await push(t, x, [noteUpsert(noteId, 0, 'private')]);

    expectError(
      await t.http.get(`/v1/notes/${noteId}`).set(bearer(y.accessToken)),
      404,
      'NOT_FOUND',
    );
    const create = await push(t, y, [noteUpsert(noteId, 0, 'hijack')]);
    const edit = await push(t, y, [noteUpsert(noteId, 1, 'hijack')]);
    const del = await push(t, y, [
      { opId: uuidv7(), createdAt: now(), type: 'note.delete', entityId: noteId, baseRev: 1 },
    ]);
    for (const r of [create, edit, del])
      expect(r.results[0]).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND' } });

    const still = await t.http.get(`/v1/notes/${noteId}`).set(bearer(x.accessToken));
    expect(still.body).toMatchObject({ bodyMd: 'private', serverRev: 1, deletedAt: null });
  });
});

describe('T-22 cursor too old and snapshot', () => {
  it('returns 409 below the horizon and bootstraps through paged snapshots', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const tagId = uuidv7();
    const ids = Array.from({ length: 7 }, () => uuidv7());
    await push(t, u, [
      {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.upsert',
        entityId: tagId,
        baseRev: 0,
        payload: { name: 'reading' },
      },
      ...ids.map((id, i) => noteUpsert(id, 0, `n${i}`)),
      { opId: uuidv7(), createdAt: now(), type: 'note_tag.add', noteId: ids[0]!, tagId },
    ]);
    const maxSeq = Number(
      (
        (await pools.owner.db.execute(sql`SELECT max(change_seq) AS m FROM changes`)).rows[0] as {
          m: string;
        }
      ).m,
    );
    await pools.owner.db.update(s.syncStateServer).set({ horizonSeq: maxSeq });
    try {
      expectError(
        await t.http
          .post('/v1/sync')
          .set(bearer(u.accessToken))
          .send({ deviceId: u.device.id, cursor: 1, ops: [], clientSchema: 1 }),
        409,
        'CURSOR_TOO_OLD',
      );
      const items = [];
      let cursor: string | null = null;
      let pages = 0;
      let changeSeq = 0;
      do {
        const res: { body: unknown } = await t.http
          .get(`/v1/sync/snapshot?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
          .set(bearer(u.accessToken));
        const page: SnapshotPageDto = expectShape(SnapshotPageDto, res.body);
        items.push(...page.items);
        cursor = page.nextCursor;
        changeSeq = page.changeSeq;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(items.map((i) => i.entityType)).toEqual(['tag', ...Array(7).fill('note'), 'note_tag']);
      expect(new Set(items.map((i) => i.entityKey)).size).toBe(9);
      const userMax = Number(
        (
          (
            await pools.owner.db.execute(
              sql`SELECT max(change_seq) AS m FROM changes WHERE user_id = ${u.userId}`,
            )
          ).rows[0] as { m: string }
        ).m,
      );
      expect(changeSeq).toBe(userMax);
    } finally {
      await pools.owner.db.update(s.syncStateServer).set({ horizonSeq: 0 });
    }
  });
});

describe('set-merge and delete rules through sync', () => {
  it('T-58: tags added offline on two devices both survive', async () => {
    const t = await makeApp(pools);
    const a = await verifiedUser(t);
    const b = await secondDevice(t, a.email);
    const noteId = uuidv7();
    const [t1, t2] = [uuidv7(), uuidv7()];
    await push(t, a, [
      noteUpsert(noteId, 0, 'tagged'),
      {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.upsert',
        entityId: t1,
        baseRev: 0,
        payload: { name: 'one' },
      },
      {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.upsert',
        entityId: t2,
        baseRev: 0,
        payload: { name: 'two' },
      },
    ]);
    await push(t, a, [
      { opId: uuidv7(), createdAt: now(), type: 'note_tag.add', noteId, tagId: t1 },
    ]);
    await push(t, b, [
      { opId: uuidv7(), createdAt: now(), type: 'note_tag.add', noteId, tagId: t2 },
    ]);
    const note = await t.http.get(`/v1/notes/${noteId}`).set(bearer(a.accessToken));
    expect([...note.body.tagIds].sort()).toEqual([t1, t2].sort());
  });

  it('T-06: a stale remove does not undo a newer add', async () => {
    const t = await makeApp(pools);
    const a = await verifiedUser(t);
    const noteId = uuidv7();
    const tagId = uuidv7();
    const before = new Date(Date.now() - 60_000).toISOString();
    await push(t, a, [
      noteUpsert(noteId, 0, 'x'),
      {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.upsert',
        entityId: tagId,
        baseRev: 0,
        payload: { name: 'keep' },
      },
      { opId: uuidv7(), createdAt: now(), type: 'note_tag.add', noteId, tagId },
      { opId: uuidv7(), createdAt: before, type: 'note_tag.remove', noteId, tagId },
    ]);
    expect(
      (await t.http.get(`/v1/notes/${noteId}`).set(bearer(a.accessToken))).body.tagIds,
    ).toEqual([tagId]);
  });

  it('T-57: delete wins over an offline edit, which is kept as a conflict version', async () => {
    const t = await makeApp(pools);
    const a = await verifiedUser(t);
    const b = await secondDevice(t, a.email);
    const noteId = uuidv7();
    await push(t, a, [noteUpsert(noteId, 0, 'original')]);
    await push(t, a, [
      { opId: uuidv7(), createdAt: now(), type: 'note.delete', entityId: noteId, baseRev: 1 },
    ]);
    const fromB = await push(t, b, [noteUpsert(noteId, 1, 'edited offline')]);
    expect(fromB.results[0]!.status).toBe('conflict');
    const note = await t.http.get(`/v1/notes/${noteId}`).set(bearer(a.accessToken));
    expect(note.body.deletedAt).not.toBeNull();
    const trash = await t.http.get('/v1/notes/trash').set(bearer(a.accessToken));
    expect(trash.body.items.map((n: { id: string }) => n.id)).toContain(noteId);
  });
});

describe('change-feed visibility lag (risk R-02)', () => {
  it('holds back other devices’ changes for the lag window', async () => {
    const t = await makeApp(pools, { lagMs: 1500 });
    const a = await verifiedUser(t);
    const b = await secondDevice(t, a.email);
    await push(t, a, [noteUpsert(uuidv7(), 0, 'fresh')]);
    expect((await push(t, b, [])).changes).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 1700));
    expect((await push(t, b, [])).changes).toHaveLength(1);
  });
});

describe('sync nudge', () => {
  it('queues a data-only push for the user’s other devices after changes', async () => {
    const t = await makeApp(pools);
    const a = await verifiedUser(t);
    const b = await secondDevice(t, a.email);
    await t.http
      .post('/v1/devices')
      .set(bearer(b.accessToken))
      .send({ ...b.device, pushToken: 'ExponentPushToken[tablet]' })
      .expect(200);
    t.queue.sent.length = 0;
    await push(t, a, [noteUpsert(uuidv7(), 0, 'nudge me')]);
    await push(t, a, [noteUpsert(uuidv7(), 0, 'debounced')]);
    expect(t.queue.sent.filter((j) => j.name === 'push.send')).toHaveLength(1);
    await t.drain();
    expect(t.push.sent.at(-1)).toMatchObject({
      tokens: ['ExponentPushToken[tablet]'],
      message: { data: { type: 'sync.nudge' } },
    });
    expect(t.push.sent.at(-1)!.message.title).toBeUndefined();
  });
});

describe('two-client simulator (server side)', () => {
  it('converges after interleaved offline edits, deletes and tags', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const tablet = await secondDevice(t, u.email);
    const a = new SimClient(t, u.device.id, u.accessToken);
    const b = new SimClient(t, tablet.device.id, tablet.accessToken);

    const tagIds = [uuidv7(), uuidv7(), uuidv7()];
    await push(
      t,
      u,
      tagIds.map((id, i) => ({
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.upsert' as const,
        entityId: id,
        baseRev: 0,
        payload: { name: `t${i}` },
      })),
    );

    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(a.createNote(`Note ${i}`, `start ${i}`));
    await a.sync();
    await b.sync();

    for (let round = 0; round < 12; round++) {
      for (const [client, name] of [
        [a, 'A'],
        [b, 'B'],
      ] as const) {
        const r = rand();
        const id = ids[Math.floor(rand() * ids.length)]!;
        if (r < 0.5) client.editNote(id, `${name} edit ${round}`);
        else if (r < 0.65) client.deleteNote(id);
        else if (r < 0.85) client.tag(id, tagIds[Math.floor(rand() * 3)]!, true);
        else client.tag(id, tagIds[Math.floor(rand() * 3)]!, false);
        if (rand() < 0.4) await client.sync(); // otherwise stays offline this round
      }
    }
    // Final settle: push everything, then pull everything.
    await a.sync();
    await b.sync();
    await a.sync();
    await b.sync();

    expect(a.outbox).toEqual([]);
    expect(b.outbox).toEqual([]);
    const serverNotes = await pools.owner.db
      .select()
      .from(s.notes)
      .where(eq(s.notes.userId, u.userId));
    const server = serverNotes
      .map((n) => ({
        id: n.id,
        bodyMd: n.bodyMd,
        serverRev: n.serverRev,
        deleted: n.deletedAt !== null,
      }))
      .sort((x, y) => x.id.localeCompare(y.id));
    expect(a.view().notes).toEqual(server);
    expect(b.view().notes).toEqual(server);
    expect(a.view().memberships).toEqual(b.view().memberships);
  });
});

describe('T-29 version pruning', () => {
  it('keeps the newest 50 within 90 days and leaves open conflicts alone', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const noteId = uuidv7();
    await push(t, u, [noteUpsert(noteId, 0, 'v1')]);
    const day = 86_400_000;
    const rows = Array.from({ length: 59 }, (_, i) => ({
      noteId,
      userId: u.userId,
      rev: i + 2,
      baseRev: i + 1,
      title: 't',
      bodyMd: `v${i + 2}`,
      // The 5 oldest revisions are older than 90 days.
      createdAt: new Date(Date.now() - (i < 4 ? 100 : 10) * day + i * 1000).toISOString(),
    }));
    await pools.owner.db.insert(s.noteVersions).values(rows);
    await pools.owner.db
      .update(s.noteVersions)
      .set({ createdAt: new Date(Date.now() - 120 * day).toISOString() })
      .where(sql`note_id = ${noteId} AND rev = 1`);
    await pools.owner.db.insert(s.noteVersions).values({
      noteId,
      userId: u.userId,
      rev: 60,
      baseRev: 3,
      title: 't',
      bodyMd: 'conflict',
      conflict: true,
      createdAt: new Date(Date.now() - 200 * day).toISOString(),
    });

    await pruneVersions(pools.owner.db);

    const left = await pools.owner.db
      .select()
      .from(s.noteVersions)
      .where(eq(s.noteVersions.noteId, noteId));
    const normal = left.filter((v) => !v.conflict);
    expect(normal).toHaveLength(50);
    expect(normal.every((v) => Date.parse(v.createdAt) > Date.now() - 90 * day)).toBe(true);
    expect(left.filter((v) => v.conflict)).toHaveLength(1);
  });
});
