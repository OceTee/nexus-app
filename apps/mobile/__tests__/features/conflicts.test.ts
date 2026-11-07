import type { NoteDto } from '@nexus/shared';
import { events } from '../../src/data/events';
import { repos } from '../../src/data/repos';
import type { ConflictRow, NoteRow } from '../../src/data/rows';
import { resolveConflict } from '../../src/features/sync/conflicts';
import { ApiError, api } from '../../src/infra/apiClient';
import { getDb } from '../../src/infra/db';
import type { SqlDb } from '../../src/infra/sql';
import { createTestDb } from '../../src/test/nodeSqlite';

// The app-wide `repos` read the database through getDb(); point it at a test db.
jest.mock('../../src/infra/db', () => ({ getDb: jest.fn() }));
// Keep ApiError real; script api() per test.
jest.mock('../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../src/infra/apiClient'),
  api: jest.fn(),
}));

const apiMock = jest.mocked(api);
let db: SqlDb;

const T0 = '2026-01-01T00:00:00.000Z';
const NOTE = 'note-1';

/**
 * A synced note at server rev 3 with two open conflicts (stacked edits from
 * one device) and this device's losing copy stored as version `mine`.
 */
async function seed({ dirty = false } = {}) {
  await db.runAsync(
    `INSERT INTO notes (id, title, title_norm, body_md, server_rev, local_rev, dirty, created_at, updated_at)
     VALUES (?, 'Server', 'server', 'server body', 3, 1, ?, ?, ?)`,
    [NOTE, dirty ? 1 : 0, T0, T0],
  );
  await db.runAsync(
    `INSERT INTO note_versions_local (id, note_id, rev, base_rev, title, body_md, conflict, source, created_at)
     VALUES ('mine', ?, 1, 2, 'Mine', 'my body', 1, 'conflict', ?)`,
    [NOTE, T0],
  );
  for (const id of ['c1', 'c2']) {
    await db.runAsync(
      `INSERT INTO conflicts (id, note_id, version_id, server_rev, created_at) VALUES (?, ?, 'mine', 3, ?)`,
      [id, NOTE, T0],
    );
  }
  return (await repos.conflicts.get('c1'))!;
}

const note = () =>
  db.getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [NOTE]) as Promise<NoteRow>;
const openConflicts = () => repos.conflicts.open(NOTE);
const outbox = () => repos.outbox.all(db);

const serverNote = (over: Partial<NoteDto> = {}): NoteDto => ({
  id: NOTE,
  title: 'Resolved',
  bodyMd: 'resolved body',
  excerpt: '',
  collectionId: null,
  isPinned: false,
  wordCount: 2,
  serverRev: 4,
  tagIds: [],
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  jest.mocked(getDb).mockReturnValue(db);
  apiMock.mockReset();
});

describe('resolveConflict online', () => {
  it('lets the server apply the choice and adopts the returned note', async () => {
    const conflict = await seed();
    apiMock.mockResolvedValue(serverNote());
    const changed = jest.fn();
    const off = events.on(['notes'], changed);

    await resolveConflict(conflict, 'keep_server');
    off();

    expect(apiMock).toHaveBeenCalledWith(`/v1/notes/${NOTE}/conflicts/mine/resolve`, {
      method: 'POST',
      body: { strategy: 'keep_server', baseRev: 3 },
    });
    expect(await note()).toMatchObject({
      title: 'Resolved',
      body_md: 'resolved body',
      server_rev: 4,
      dirty: 0,
    });
    expect(changed).toHaveBeenCalled();
    // Nothing is queued: the server already has the result.
    expect(await outbox()).toEqual([]);
  });

  it('settles every open conflict on the note, not just the one chosen', async () => {
    const conflict = await seed();
    apiMock.mockResolvedValue(serverNote());
    await resolveConflict(conflict, 'keep_mine');
    expect(await openConflicts()).toEqual([]);
  });

  it('sends the merged text with a merged resolution', async () => {
    const conflict = await seed();
    apiMock.mockResolvedValue(serverNote({ title: 'Both', bodyMd: 'both' }));
    await resolveConflict(conflict, 'merged', { title: 'Both', bodyMd: 'both' });
    expect(apiMock.mock.calls[0]![1]).toEqual({
      method: 'POST',
      body: { strategy: 'merged', baseRev: 3, title: 'Both', bodyMd: 'both' },
    });
    expect((await note()).title).toBe('Both');
  });

  it('omits merged text when none was given', async () => {
    const conflict = await seed();
    apiMock.mockResolvedValue(serverNote());
    await resolveConflict(conflict, 'merged');
    expect(apiMock.mock.calls[0]![1]).toEqual({
      method: 'POST',
      body: { strategy: 'merged', baseRev: 3 },
    });
  });
});

describe('resolveConflict with unsent local edits', () => {
  it('saves my copy locally without calling the server', async () => {
    const conflict = await seed({ dirty: true });
    await resolveConflict(conflict, 'keep_mine');
    expect(apiMock).not.toHaveBeenCalled();
    expect(await note()).toMatchObject({ title: 'Mine', body_md: 'my body', dirty: 1 });
    expect(await outbox()).toEqual([
      expect.objectContaining({ entity_id: NOTE, op: 'upsert', base_rev: 3 }),
    ]);
    expect(await openConflicts()).toEqual([]);
  });

  it('saves the merged text locally', async () => {
    const conflict = await seed({ dirty: true });
    await resolveConflict(conflict, 'merged', { title: 'Both', bodyMd: 'both' });
    expect(await note()).toMatchObject({ title: 'Both', body_md: 'both' });
  });

  it('keeps the current text for keep_server', async () => {
    const conflict = await seed({ dirty: true });
    await resolveConflict(conflict, 'keep_server');
    expect((await note()).title).toBe('Server');
    expect(await outbox()).toEqual([]);
    expect(await openConflicts()).toEqual([]);
  });

  it('writes nothing for keep_mine when my copy is gone', async () => {
    const conflict = await seed({ dirty: true });
    await db.runAsync(`DELETE FROM note_versions_local`);
    await resolveConflict(conflict, 'keep_mine');
    expect((await note()).title).toBe('Server');
    expect(await openConflicts()).toEqual([]);
  });

  it('writes nothing for merged without merged text', async () => {
    const conflict = await seed({ dirty: true });
    await resolveConflict(conflict, 'merged');
    expect(await outbox()).toEqual([]);
  });
});

describe('resolveConflict when the server call fails', () => {
  it.each([
    ['offline', new ApiError(0, 'NETWORK', 'offline')],
    ['already resolved elsewhere (409)', new ApiError(409, 'CONFLICT', 'stale')],
    ['a non-API error', new TypeError('fetch failed')],
  ])('falls back to a local write when %s', async (_label, error) => {
    const conflict = await seed();
    apiMock.mockRejectedValue(error);
    await resolveConflict(conflict, 'keep_mine');
    expect(await note()).toMatchObject({ title: 'Mine', dirty: 1 });
    expect(await outbox()).toHaveLength(1);
    expect(await openConflicts()).toEqual([]);
  });

  it('just closes the conflicts on 404', async () => {
    const conflict = await seed();
    apiMock.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await resolveConflict(conflict, 'keep_mine');
    expect((await note()).title).toBe('Server');
    expect(await outbox()).toEqual([]);
    expect(await openConflicts()).toEqual([]);
  });

  it('rethrows other server errors and leaves the conflicts open', async () => {
    const conflict = await seed();
    apiMock.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    await expect(resolveConflict(conflict, 'keep_mine')).rejects.toThrow('boom');
    expect(await openConflicts()).toHaveLength(2);
  });
});

it('closes only the given conflict when the note no longer exists', async () => {
  const conflict = await seed();
  await db.runAsync(`DELETE FROM notes`);
  await resolveConflict(conflict, 'keep_mine');
  expect(apiMock).not.toHaveBeenCalled();
  const open = await openConflicts();
  expect(open.map((c: ConflictRow) => c.id)).toEqual(['c2']);
});
