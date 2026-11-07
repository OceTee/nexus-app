import type { SnapshotPageDto, SyncPushRequest, SyncResponse } from '@nexus/shared';
import { events } from '../../../src/data/events';
import { repos } from '../../../src/data/repos';
import type { NoteRow } from '../../../src/data/rows';
import {
  bootstrapSnapshot,
  fetchSyncStatus,
  isSyncRunning,
  resetAndRedownload,
  retryFailed,
  runSync,
} from '../../../src/data/sync/engine';
import { useSyncStore } from '../../../src/data/sync/store';
import { ApiError, api } from '../../../src/infra/apiClient';
import { getDb } from '../../../src/infra/db';
import { secureStore } from '../../../src/infra/secureStore';
import type { SqlDb } from '../../../src/infra/sql';
import { useSessionStore } from '../../../src/stores/session';
import { createTestDb } from '../../../src/test/nodeSqlite';

// The app-wide `repos` and the engine read the database through getDb(); point it at a test db.
jest.mock('../../../src/infra/db', () => ({ getDb: jest.fn() }));
// Keep ApiError real; script api() per test.
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));
jest.mock('../../../src/infra/secureStore', () => ({
  secureStore: { clearRefreshToken: jest.fn().mockResolvedValue(undefined) },
}));
// In-memory preferences (the engine remembers a refused client schema there).
jest.mock('../../../src/infra/kv', () => {
  const values = new Map<string, string>();
  return {
    kv: {
      values,
      get: (k: string) => values.get(k) ?? null,
      set: jest.fn((k: string, v: string) => void values.set(k, v)),
      remove: jest.fn((k: string) => void values.delete(k)),
      setJson: jest.fn(),
    },
  };
});

const apiMock = jest.mocked(api);
let db: SqlDb;

const NOW = 1_800_000_000_000;
const user = { id: 'u1', email: 'a@b.c', displayName: 'A', emailVerified: true };

/** An empty "nothing more" response; tests override fields. */
const response = (over: Partial<SyncResponse> = {}): SyncResponse => ({
  results: [],
  changes: [],
  conflicts: [],
  cursor: 0,
  hasMore: false,
  serverTime: new Date(NOW).toISOString(),
  ...over,
});

/** Acknowledges every pushed op as applied at `serverRev`. */
const ackAll = (body: SyncPushRequest, serverRev = 1) =>
  body.ops.map((o) => ({ opId: o.opId, status: 'applied' as const, serverRev }));

/** Routes POST /v1/sync to `handler`, recording the request bodies. */
function serveSync(handler: (body: SyncPushRequest, call: number) => SyncResponse | Error) {
  const bodies: SyncPushRequest[] = [];
  apiMock.mockImplementation(async (path, opts) => {
    if (path !== '/v1/sync') throw new Error(`unexpected ${path}`);
    const body = opts!.body as SyncPushRequest;
    bodies.push(structuredClone(body));
    const out = handler(body, bodies.length);
    if (out instanceof Error) throw out;
    return out;
  });
  return bodies;
}

/** Polls (real timers) until `cond` holds. */
async function until(cond: () => Promise<boolean>) {
  for (let i = 0; i < 100; i += 1) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('condition not met');
}

const note = (id: string) =>
  db.getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]) as Promise<NoteRow>;
const outbox = () => repos.outbox.all(db);
const syncState = () => useSyncStore.getState().state;

beforeEach(async () => {
  (
    jest.requireMock('../../../src/infra/kv') as { kv: { values: Map<string, string> } }
  ).kv.values.clear();
  db = await createTestDb();
  jest.mocked(getDb).mockReturnValue(db);
  apiMock.mockReset();
  useSessionStore.setState({ status: 'authed', deviceId: 'dev-1', user, sessionExpired: false });
  useSyncStore.setState({ state: { kind: 'idle' }, online: null, errors: [], lastSyncAt: null });
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => jest.restoreAllMocks());

describe('runSync preconditions', () => {
  it.each([
    ['signed out', { status: 'anon' as const }, 'signed-out'],
    ['without a device id', { deviceId: null }, 'signed-out'],
    ['unverified', { user: { ...user, emailVerified: false } }, 'unverified'],
  ])('pauses when %s', async (_label, session, why) => {
    useSessionStore.setState(session);
    expect(await runSync('start')).toEqual({ kind: 'skipped', reason: 'paused' });
    expect(syncState()).toEqual({ kind: 'paused', why });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('skips automatic runs while offline', async () => {
    useSyncStore.setState({ online: false });
    expect(await runSync('periodic')).toEqual({ kind: 'skipped', reason: 'offline' });
    expect(syncState()).toEqual({ kind: 'offline' });
  });

  it('still tries a manual run while offline', async () => {
    useSyncStore.setState({ online: false });
    serveSync(() => response());
    expect(await runSync('manual')).toEqual({ kind: 'ok', batches: 1 });
  });

  it('runs one sync at a time', async () => {
    let release!: () => void;
    apiMock.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(response()))),
    );
    const first = runSync('manual');
    expect(isSyncRunning()).toBe(true);
    expect(await runSync('write')).toEqual({ kind: 'skipped', reason: 'busy' });
    // Let the first run reach the api call before releasing it.
    await new Promise((r) => setImmediate(r));
    release();
    expect(await first).toEqual({ kind: 'ok', batches: 1 });
    expect(isSyncRunning()).toBe(false);
  });
});

describe('runSync loop', () => {
  it('pushes the outbox, applies results and changes, and saves the cursor', async () => {
    const n = await repos.notes.save({ title: 'Mine', bodyMd: 'hello' });
    const changed = jest.fn();
    const off = events.on(['notes'], changed);
    const bodies = serveSync((body) =>
      response({
        results: ackAll(body, 3),
        changes: [
          {
            seq: 41,
            entityType: 'tag',
            entityKey: 't1',
            op: 'upsert',
            rev: 1,
            data: { id: 't1', name: 'Work', colour: null, noteCount: 0, serverRev: 1 },
          },
        ],
        conflicts: [
          {
            noteId: n.id,
            versionId: 'v1',
            serverRev: 3,
            deviceId: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        cursor: 42,
      }),
    );

    expect(await runSync('manual')).toEqual({ kind: 'ok', batches: 1 });
    off();

    expect(bodies).toEqual([
      expect.objectContaining({ deviceId: 'dev-1', cursor: 0, clientSchema: 1 }),
    ]);
    expect(bodies[0]!.ops).toEqual([
      expect.objectContaining({ type: 'note.upsert', entityId: n.id, baseRev: 0 }),
    ]);
    expect(await note(n.id)).toMatchObject({ server_rev: 3, dirty: 0 });
    expect(await outbox()).toEqual([]);
    expect(await repos.syncState.cursor()).toBe(42);
    expect(await repos.tags.get('t1')).toMatchObject({ name: 'Work' });
    expect(await repos.conflicts.open(n.id)).toHaveLength(1);
    expect(changed).toHaveBeenCalled();
    expect(useSyncStore.getState()).toMatchObject({ state: { kind: 'idle' }, lastSyncAt: NOW });
  });

  it('pages while the server has more, sending the latest cursor each time', async () => {
    const bodies = serveSync((_b, call) => response({ cursor: call * 10, hasMore: call < 3 }));
    expect(await runSync('start')).toEqual({ kind: 'ok', batches: 3 });
    expect(bodies.map((b) => b.cursor)).toEqual([0, 10, 20]);
    expect(await repos.syncState.cursor()).toBe(30);
  });

  it('keeps pushing until the outbox is empty', async () => {
    await repos.notes.save({ title: 'A', bodyMd: '' });
    // The first response does not acknowledge the op, so it is sent again.
    const bodies = serveSync((body, call) => response({ results: call === 1 ? [] : ackAll(body) }));
    expect(await runSync('write')).toEqual({ kind: 'ok', batches: 2 });
    expect(bodies.map((b) => b.ops.length)).toEqual([1, 1]);
    expect(await outbox()).toEqual([]);
  });

  it('leaves a write made during an empty exchange for the next run', async () => {
    serveSync((_b, call) => {
      if (call === 1) void repos.notes.save({ title: 'Typed meanwhile', bodyMd: '' });
      return response();
    });
    expect(await runSync('start')).toEqual({ kind: 'ok', batches: 1 });
    expect(await outbox()).toHaveLength(1);
  });

  it('stops after MAX_BATCHES (200) when the server keeps saying hasMore', async () => {
    serveSync(() => response({ hasMore: true }));
    expect(await runSync('start')).toEqual({ kind: 'ok', batches: 200 });
    expect(apiMock).toHaveBeenCalledTimes(200);
  });

  it('records rejected ops as sync errors', async () => {
    await repos.notes.save({ title: 'Bad', bodyMd: '' });
    serveSync((body) =>
      response({
        results: body.ops.map((o) => ({
          opId: o.opId,
          status: 'rejected' as const,
          error: { code: 'VALIDATION', message: 'Too long' },
        })),
      }),
    );
    await runSync('manual');
    expect(useSyncStore.getState().errors).toEqual([
      expect.objectContaining({ code: 'VALIDATION', message: 'note.upsert: Too long' }),
    ]);
  });
});

describe('runSync failures', () => {
  beforeEach(async () => {
    await repos.notes.save({ title: 'Queued', bodyMd: '' });
  });

  it('goes offline on a network error and releases the in-flight ops', async () => {
    const outboxEvents = jest.fn();
    const off = events.on(['outbox'], outboxEvents);
    serveSync(() => new ApiError(0, 'NETWORK', 'Could not reach the NEXUS server'));
    const outcome = await runSync('write');
    off();
    expect(outcome).toEqual({ kind: 'error', error: expect.any(ApiError) });
    expect(syncState()).toEqual({ kind: 'offline' });
    expect(await outbox()).toEqual([
      expect.objectContaining({
        status: 'pending',
        attempts: 1,
        last_error: 'NETWORK: Could not reach the NEXUS server',
      }),
    ]);
    expect(outboxEvents).toHaveBeenCalled();
    expect(useSyncStore.getState().errors).toEqual([]);
  });

  it('retries a 401 on the backoff schedule without parking ops', async () => {
    serveSync(() => new ApiError(401, 'UNAUTHENTICATED', 'Session expired'));
    for (let i = 0; i < 4; i += 1) await runSync('retry');
    expect(syncState()).toEqual({
      kind: 'error',
      code: 'UNAUTHENTICATED',
      message: 'Session expired',
      retryAt: NOW + 16_000,
    });
    expect((await outbox())[0]).toMatchObject({ status: 'pending', attempts: 4 });
    expect(useSyncStore.getState().errors).toHaveLength(4);
  });

  it('resets the backoff after a successful run', async () => {
    // The backoff lives in the engine module, so start from a success to reset it.
    serveSync((body, call) =>
      call === 2 || call === 3 || call === 5
        ? new ApiError(500, 'INTERNAL', 'boom')
        : response({ results: ackAll(body) }),
    );
    await runSync('retry');
    await repos.notes.save({ title: 'Again', bodyMd: '' });
    await runSync('retry');
    await runSync('retry');
    expect(syncState()).toMatchObject({ retryAt: NOW + 4_000 });
    await runSync('retry');
    expect(syncState()).toEqual({ kind: 'idle' });
    await repos.notes.save({ title: 'Once more', bodyMd: '' });
    await runSync('retry');
    expect(syncState()).toMatchObject({ retryAt: NOW + 2_000 });
  });

  it('honours Retry-After', async () => {
    serveSync(() => new ApiError(429, 'RATE_LIMITED', 'Slow down', undefined, 30));
    await runSync('retry');
    expect(syncState()).toMatchObject({ code: 'RATE_LIMITED', retryAt: NOW + 30_000 });
  });

  it('parks ops refused by a 4xx after 3 attempts (S-32)', async () => {
    serveSync(() => new ApiError(400, 'VALIDATION', 'Bad batch'));
    await runSync('retry');
    await runSync('retry');
    expect((await outbox())[0]).toMatchObject({ status: 'pending', attempts: 2 });
    await runSync('retry');
    expect((await outbox())[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
      last_error: 'VALIDATION: Bad batch',
    });
    // Failed ops no longer count as pending.
    expect(await repos.outbox.pendingCount(db)).toBe(0);
  });

  it('reports unexpected errors as SYNC_FAILED', async () => {
    serveSync(() => new TypeError('kaboom'));
    await runSync('retry');
    expect(syncState()).toMatchObject({ kind: 'error', code: 'SYNC_FAILED', message: 'kaboom' });
    expect((await outbox())[0]!.last_error).toBe('TypeError: kaboom');
  });

  it('reports non-Error throws with a generic message', async () => {
    apiMock.mockRejectedValue('weird');
    await runSync('retry');
    expect(syncState()).toMatchObject({ code: 'SYNC_FAILED', message: 'Sync failed' });
    expect((await outbox())[0]!.last_error).toBe('weird');
  });

  it('expires the session when the device was revoked (BR-12)', async () => {
    serveSync(() => new ApiError(401, 'DEVICE_REVOKED', 'Device removed'));
    const outcome = await runSync('start');
    expect(outcome.kind).toBe('error');
    expect(secureStore.clearRefreshToken).toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({ status: 'local', sessionExpired: true });
    expect(syncState()).toEqual({ kind: 'paused', why: 'signed-out' });
    // Everything stays queued for the next sign-in.
    expect(await outbox()).toEqual([
      expect.objectContaining({ status: 'pending', last_error: 'DEVICE_REVOKED' }),
    ]);
  });
});

describe('T-88 schema gate', () => {
  const tooOld = () => new ApiError(426, 'CLIENT_SCHEMA_TOO_OLD', 'Update the app to keep syncing');

  it('pauses sync until the app is updated, keeping changes queued', async () => {
    await repos.notes.save({ title: 'Kept', bodyMd: 'local' });
    const bodies = serveSync(tooOld);

    expect((await runSync('start')).kind).toBe('error');
    expect(syncState()).toEqual({ kind: 'paused', why: 'update-required' });
    expect(await outbox()).toEqual([
      expect.objectContaining({ status: 'pending', last_error: 'CLIENT_SCHEMA_TOO_OLD' }),
    ]);

    // Automatic triggers don't ask the server again…
    expect(await runSync('periodic')).toEqual({ kind: 'skipped', reason: 'paused' });
    expect(bodies).toHaveLength(1);
  });

  it('asks again on a manual sync, in case the server lowered its minimum', async () => {
    serveSync(tooOld);
    await runSync('start');
    const bodies = serveSync(() => response());
    expect(await runSync('manual')).toEqual({ kind: 'ok', batches: 1 });
    expect(bodies).toHaveLength(1);
    expect(syncState()).toEqual({ kind: 'idle' });
  });
});

describe('cursor expiry and snapshots', () => {
  const tagItem = (id: string, seq: number): SnapshotPageDto['items'][number] => ({
    seq,
    entityType: 'tag',
    entityKey: id,
    op: 'upsert',
    rev: 1,
    data: { id, name: id, colour: null, noteCount: 0, serverRev: 1 },
  });
  const pages: SnapshotPageDto[] = [
    { items: [tagItem('t1', 1)], nextCursor: 'p/2', hasMore: true, changeSeq: 0 },
    { items: [tagItem('t2', 2)], nextCursor: null, hasMore: false, changeSeq: 77 },
  ];

  let body: SyncPushRequest | undefined;
  const lastBody = () => body!;

  /** Serves the snapshot pages; POST /v1/sync answers with `sync`. */
  function serve(sync: () => SyncResponse | Error, snapshot: () => SnapshotPageDto | Error) {
    const paths: string[] = [];
    let page = 0;
    apiMock.mockImplementation(async (path, opts) => {
      paths.push(path);
      body = opts?.body as SyncPushRequest | undefined;
      const out =
        path === '/v1/sync' ? sync() : path.startsWith('/v1/sync/snapshot') ? snapshot() : null;
      if (out === null) throw new Error(`unexpected ${path}`);
      if (out instanceof Error) throw out;
      return out;
    });
    return { paths, nextPage: () => pages[page++]! };
  }

  it('bootstraps from a paged snapshot and adopts its change sequence', async () => {
    const { paths, nextPage } = serve(
      () => response(),
      () => nextPage(),
    );
    await bootstrapSnapshot();
    expect(paths).toEqual(['/v1/sync/snapshot', '/v1/sync/snapshot?cursor=p%2F2']);
    expect(await repos.tags.list()).toHaveLength(2);
    expect(await repos.syncState.cursor()).toBe(77);
  });

  it('re-snapshots on CURSOR_TOO_OLD and then pushes what is queued', async () => {
    await repos.notes.save({ title: 'Queued', bodyMd: '' });
    let syncCalls = 0;
    const { paths, nextPage } = serve(
      () =>
        ++syncCalls === 1
          ? new ApiError(410, 'CURSOR_TOO_OLD', 'Too old')
          : response({ results: ackAll(lastBody()), cursor: 78 }),
      () => nextPage(),
    );
    expect(await runSync('start')).toEqual({ kind: 'ok', batches: 0 });
    expect(syncState()).toEqual({ kind: 'idle' });
    expect(await repos.syncState.cursor()).toBe(77);
    // A follow-up push is scheduled on a 0 ms timer.
    await until(async () => (await outbox()).length === 0 && !isSyncRunning());
    expect(paths.filter((p) => p === '/v1/sync')).toHaveLength(2);
    expect(await repos.syncState.cursor()).toBe(78);
  });

  it('reports the original error when the snapshot itself fails', async () => {
    const snapErr = new ApiError(0, 'NETWORK', 'offline');
    serve(
      () => new ApiError(410, 'CURSOR_TOO_OLD', 'Too old'),
      () => snapErr,
    );
    expect(await runSync('start')).toEqual({ kind: 'error', error: snapErr });
    expect(syncState()).toMatchObject({ kind: 'error', code: 'CURSOR_TOO_OLD' });
  });

  it('resetAndRedownload drops synced rows, keeps dirty ones and re-reads the account', async () => {
    await db.runAsync(
      `INSERT INTO notes (id, title, server_rev, dirty, created_at, updated_at) VALUES ('clean', 'C', 1, 0, 'x', 'x')`,
    );
    await db.runAsync(
      `INSERT INTO notes (id, title, server_rev, dirty, created_at, updated_at) VALUES ('dirty', 'D', 1, 1, 'x', 'x')`,
    );
    await repos.syncState.setCursor(500);
    const { nextPage } = serve(
      () => response(),
      () => nextPage(),
    );
    await resetAndRedownload();
    expect(await db.getFirstAsync(`SELECT id FROM notes WHERE id = 'clean'`)).toBeNull();
    expect(await note('dirty')).toBeTruthy();
    expect(await repos.tags.list()).toHaveLength(2);
    expect(await repos.syncState.cursor()).toBe(77);
  });

  it('resetAndRedownload refuses while changes are pending', async () => {
    await repos.notes.save({ title: 'Queued', bodyMd: '' });
    await expect(resetAndRedownload()).rejects.toThrow('Sync or discard pending changes first');
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('retryFailed and fetchSyncStatus', () => {
  it('requeues failed ops and syncs them', async () => {
    await repos.notes.save({ title: 'Stuck', bodyMd: '' });
    await db.runAsync(`UPDATE outbox SET status = 'failed', attempts = 3`);
    const bodies = serveSync((body) => response({ results: ackAll(body) }));
    await retryFailed();
    expect(bodies[0]!.ops).toHaveLength(1);
    expect(await outbox()).toEqual([]);
  });

  it('fetches the server sync status', async () => {
    apiMock.mockResolvedValue({ serverSeq: 1 });
    await expect(fetchSyncStatus()).resolves.toEqual({ serverSeq: 1 });
    expect(apiMock).toHaveBeenCalledWith('/v1/sync/status');
  });
});
