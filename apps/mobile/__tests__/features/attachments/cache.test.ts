import type { AttachmentRow } from '../../../src/data/rows';
import {
  cachedFile,
  cacheUsage,
  ensureCached,
  evict,
  fileFor,
  isPinned,
  recordCached,
  setPinned,
} from '../../../src/features/attachments/cache';
import { api } from '../../../src/infra/apiClient';
import { setDbForTests } from '../../../src/infra/db';
import type { SqlDb } from '../../../src/infra/sql';
import { createTestDb } from '../../../src/test/nodeSqlite';
import { store } from '../fakeFileSystem';

jest.mock('expo-file-system', () => jest.requireActual('../fakeFileSystem'));
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = api as jest.MockedFunction<typeof api>;
let db: SqlDb;

const row = (id: string, over: Partial<AttachmentRow> = {}): AttachmentRow => ({
  id,
  note_id: 'n1',
  filename: `${id}.png`,
  mime_type: 'image/png',
  size_bytes: 10,
  sha256: 'abc',
  status: 'uploaded',
  width: null,
  height: null,
  server_rev: 1,
  local_rev: 1,
  dirty: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  ...over,
});

const put = (f: { uri: string }, size: number) => store.files.set(f.uri, new Uint8Array(size));

beforeEach(async () => {
  store.reset();
  mockApi.mockReset();
  db = await createTestDb();
  setDbForTests(db);
});

describe('fileFor', () => {
  it('names files by id and extension in the cache or document directory', () => {
    expect(fileFor(row('a')).uri).toBe('file:///cache/attachments/a.png');
    expect(fileFor(row('b', { mime_type: 'application/pdf' }), true).uri).toBe(
      'file:///document/attachments/b.pdf',
    );
    expect(fileFor(row('c', { mime_type: 'text/plain' })).uri).toMatch(/c\.bin$/);
    expect(store.dirs.has('file:///cache/attachments')).toBe(true);
  });
});

describe('cachedFile', () => {
  it('returns null when nothing is recorded', async () => {
    expect(await cachedFile('a')).toBeNull();
  });

  it('returns the file and touches its access time', async () => {
    const f = fileFor(row('a'));
    put(f, 5);
    await recordCached('a', f, 5);
    await db.runAsync(`UPDATE attachment_cache SET last_access_at = '2000-01-01'`);
    expect((await cachedFile('a'))?.uri).toBe(f.uri);
    const r = await db.getFirstAsync<{ last_access_at: string }>(
      `SELECT last_access_at FROM attachment_cache WHERE attachment_id = 'a'`,
    );
    expect(r!.last_access_at > '2000-01-01').toBe(true);
  });

  it('forgets a record whose file has gone', async () => {
    await recordCached('a', fileFor(row('a')), 5);
    expect(await cachedFile('a')).toBeNull();
    expect(await db.getAllAsync(`SELECT * FROM attachment_cache`)).toEqual([]);
  });
});

describe('ensureCached', () => {
  it('downloads through a presigned URL when not cached', async () => {
    mockApi.mockResolvedValue({ url: 'https://s3/a', expiresAt: 'x' });
    const file = await ensureCached(row('a'));
    expect(mockApi).toHaveBeenCalledWith('/v1/attachments/a/url');
    expect(store.downloads).toEqual(['https://s3/a']);
    expect(file.uri).toBe('file:///cache/attachments/a.png');
    expect(await isPinned('a')).toBe(false);
    expect((await cacheUsage()).cached).toBe(file.size);
  });

  it('replaces a stale file at the target before downloading', async () => {
    mockApi.mockResolvedValue({ url: 'https://s3/a', expiresAt: 'x' });
    put(fileFor(row('a')), 99);
    const file = await ensureCached(row('a'));
    expect(file.size).not.toBe(99);
  });

  it('uses the cached copy without the network', async () => {
    const f = fileFor(row('a'));
    put(f, 3);
    await recordCached('a', f, 3);
    expect((await ensureCached(row('a'))).uri).toBe(f.uri);
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('setPinned', () => {
  it('moves a file into documents and back', async () => {
    const a = row('a');
    const f = fileFor(a);
    put(f, 4);
    await recordCached('a', f, 4);

    await setPinned(a, true);
    expect(await isPinned('a')).toBe(true);
    expect(store.files.has('file:///document/attachments/a.png')).toBe(true);
    expect(store.files.has(f.uri)).toBe(false);
    expect(await cacheUsage()).toEqual({ cached: 0, pinned: 4 });

    await setPinned(a, false);
    expect(await isPinned('a')).toBe(false);
    expect(store.files.has(f.uri)).toBe(true);
  });

  it('only updates the record when the file is already in place', async () => {
    const a = row('a');
    const f = fileFor(a);
    put(f, 4);
    await recordCached('a', f, 4);
    await setPinned(a, false);
    expect(store.files.has(f.uri)).toBe(true);
  });
});

describe('evict', () => {
  it('removes least-recently-used unpinned files until under the limit', async () => {
    for (const [id, at] of [
      ['old', '2026-01-01'],
      ['mid', '2026-01-02'],
      ['new', '2026-01-03'],
    ] as const) {
      const f = fileFor(row(id));
      put(f, 100);
      await recordCached(id, f, 100, false);
      await db.runAsync(`UPDATE attachment_cache SET last_access_at = ? WHERE attachment_id = ?`, [
        at,
        id,
      ]);
    }
    const pinned = fileFor(row('pin'), true);
    put(pinned, 1000);
    await recordCached('pin', pinned, 1000, true);

    expect(await evict(150)).toBe(200);
    const left = await db.getAllAsync<{ attachment_id: string }>(
      `SELECT attachment_id FROM attachment_cache ORDER BY attachment_id`,
    );
    expect(left.map((r) => r.attachment_id)).toEqual(['new', 'pin']);
    expect(store.files.has(fileFor(row('old')).uri)).toBe(false);
  });

  it('keeps files of pending uploads and tolerates missing files', async () => {
    await db.runAsync(
      `INSERT INTO attachments (id, note_id, filename, mime_type, size_bytes, sha256, status, created_at, updated_at)
       VALUES ('p', 'n1', 'p.png', 'image/png', 50, '', 'pending', 'x', 'x')`,
    );
    await recordCached('p', fileFor(row('p')), 50);
    await recordCached('gone', fileFor(row('gone')), 50);
    expect(await evict(0)).toBe(50);
    const left = await db.getAllAsync<{ attachment_id: string }>(
      `SELECT attachment_id FROM attachment_cache`,
    );
    expect(left.map((r) => r.attachment_id)).toEqual(['p']);
  });
});
