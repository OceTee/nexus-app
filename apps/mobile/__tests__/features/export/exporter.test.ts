import { strFromU8, unzipSync } from 'fflate';
import { repos } from '../../../src/data/repos';
import { recordCached } from '../../../src/features/attachments/cache';
import {
  exportScope,
  runExport,
  type ExportOptions,
  type ExportProgress,
} from '../../../src/features/export/exporter';
import type { BundleIndex, JsonExport } from '../../../src/features/export/serialise';
import { api } from '../../../src/infra/apiClient';
import { setDbForTests } from '../../../src/infra/db';
import type { SqlDb } from '../../../src/infra/sql';
import { createTestDb } from '../../../src/test/nodeSqlite';
import { File, store } from '../fakeFileSystem';

jest.mock('expo-file-system', () => jest.requireActual('../fakeFileSystem'));
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = api as jest.MockedFunction<typeof api>;
let db: SqlDb;
let work: string, sub: string, home: string;
let kalman: string, plan: string, loose: string;

const opts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  format: 'markdown',
  collectionId: null,
  includeAttachments: false,
  includeVersions: false,
  ...over,
});

const addAttachment = async (id: string, noteId: string, cached: boolean) => {
  await db.runAsync(
    `INSERT INTO attachments (id, note_id, filename, mime_type, size_bytes, sha256, status, created_at, updated_at)
     VALUES (?, ?, ?, 'image/png', 3, 'sha', 'uploaded', 'x', 'x')`,
    [id, noteId, `${id}.png`],
  );
  if (cached) {
    const f = new File(`file:///cache/attachments/${id}.png`);
    store.files.set(f.uri, new Uint8Array([1, 2, 3]));
    await recordCached(id, f as never, 3);
  }
};

const unzip = (file: { uri: string }) => {
  const entries = unzipSync(store.files.get(file.uri)!);
  return Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v]));
};

beforeEach(async () => {
  store.reset();
  mockApi.mockReset();
  db = await createTestDb();
  setDbForTests(db);
  work = await repos.collections.save({ name: 'Work' });
  sub = await repos.collections.save({ name: 'Projects', parentId: work });
  home = await repos.collections.save({ name: 'Home' });
  plan = (await repos.notes.save({ title: 'Plan', bodyMd: 'plan', collectionId: sub })).id;
  kalman = (
    await repos.notes.save({
      title: 'Kalman',
      bodyMd: 'See [[Plan]] and [[plan]] and [[Missing]].\n\n![k](nexus://attachment/att1)',
      collectionId: work,
    })
  ).id;
  loose = (await repos.notes.save({ title: 'Loose', bodyMd: 'free', collectionId: home })).id;
  const tag = await repos.tags.save({ name: 'research', colour: '#3B5BDB' });
  await repos.tags.setMembership(kalman, tag, true);
  await repos.notes.setPinned(kalman, true);
});

describe('exportScope', () => {
  it('limits notes and attachments to a collection subtree', async () => {
    await addAttachment('att1', kalman, true);
    await addAttachment('att2', loose, false);
    const all = await exportScope(null);
    expect(all.notes).toHaveLength(3);
    expect(all.attachments).toHaveLength(2);
    expect(all.needDownload).toBe(1);

    const scoped = await exportScope(work);
    expect(scoped.notes.map((n) => n.id).sort()).toEqual([kalman, plan].sort());
    expect(scoped.attachments.map((a) => a.id)).toEqual(['att1']);
    expect(scoped.needDownload).toBe(0);
  });
});

describe('runExport (markdown)', () => {
  it('writes one file per note, attachments and an index', async () => {
    await addAttachment('att1', kalman, true);
    await addAttachment('att2', loose, false);
    mockApi.mockRejectedValue(new Error('offline'));
    const progress: ExportProgress[] = [];

    const result = await runExport(opts({ includeAttachments: true }), (p) => progress.push(p));

    expect(result.notes).toBe(3);
    expect(result.attachments).toBe(1);
    expect(result.omitted).toEqual(['att2.png']);
    expect(result.file.uri).toMatch(
      /^file:\/\/\/cache\/exports\/nexus-markdown-\d{4}-\d\d-\d\d\.zip$/,
    );
    expect(progress.at(-1)).toEqual({ phase: 'done', done: 1, total: 1 });
    expect(progress.map((p) => p.phase)).toEqual(
      expect.arrayContaining(['attachments', 'notes', 'zip', 'done']),
    );

    const files = unzip(result.file);
    expect(Object.keys(files).sort()).toEqual([
      'Home/Loose.md',
      'Work/Kalman.md',
      'Work/Projects/Plan.md',
      'attachments/att1-att1.png',
      'index.json',
    ]);
    expect([...files['attachments/att1-att1.png']!]).toEqual([1, 2, 3]);

    const md = strFromU8(files['Work/Kalman.md']!);
    expect(md).toContain('collection: Work\n');
    expect(md).toContain('tags:\n  - research\n');
    expect(md).toContain('links:\n  - Plan\n  - Missing\n');
    expect(md).toContain('pinned: true\n');
    // Attachment references point at the bundled file, relative to the note.
    expect(md).toContain('![k](../attachments/att1-att1.png)');

    const index = JSON.parse(strFromU8(files['index.json']!)) as BundleIndex;
    expect(index).toMatchObject({ format: 'nexus-markdown-bundle', version: 1 });
    expect(index.notes).toContainEqual({ id: plan, title: 'Plan', path: 'Work/Projects/Plan.md' });
    expect(index.attachments).toEqual(
      expect.arrayContaining([
        { id: 'att1', noteId: kalman, filename: 'att1.png', path: 'attachments/att1-att1.png' },
        { id: 'att2', noteId: loose, filename: 'att2.png', path: null },
      ]),
    );
    expect(index.collections).toHaveLength(3);
    expect(index.tags).toEqual([expect.objectContaining({ name: 'research', colour: '#3B5BDB' })]);
  });

  it('downloads attachments that are not cached', async () => {
    await addAttachment('att2', loose, false);
    mockApi.mockResolvedValue({ url: 'https://s3/att2', expiresAt: 'x' });
    const result = await runExport(opts({ includeAttachments: true }), () => {});
    expect(result.attachments).toBe(1);
    expect(store.downloads).toEqual(['https://s3/att2']);
  });

  it('replaces an earlier export from the same day', async () => {
    const first = await runExport(opts({ collectionId: home }), () => {});
    const second = await runExport(opts({ collectionId: home }), () => {});
    expect(second.file.uri).toBe(first.file.uri);
    expect(Object.keys(unzip(second.file)).sort()).toEqual(['Home/Loose.md', 'index.json']);
  });
});

describe('runExport (json)', () => {
  it('exports every entity, optionally with local versions', async () => {
    await addAttachment('att1', kalman, true);
    await repos.notes.save({ id: plan, title: 'Plan', bodyMd: 'plan v2' });

    const result = await runExport(opts({ format: 'json', includeVersions: true }), () => {});
    expect(result.file.uri).toMatch(/nexus-json-.*\.zip$/);

    const files = unzip(result.file);
    expect(Object.keys(files)).toEqual(['nexus.json']);
    const out = JSON.parse(strFromU8(files['nexus.json']!)) as JsonExport;
    expect(out).toMatchObject({ format: 'nexus-json', version: 1 });
    expect(out.notes).toHaveLength(3);
    expect(out.attachments).toEqual([
      {
        id: 'att1',
        noteId: kalman,
        filename: 'att1.png',
        mimeType: 'image/png',
        sizeBytes: 3,
        sha256: 'sha',
      },
    ]);
    const planOut = out.notes.find((n) => n.id === plan)!;
    expect(planOut.versions!.length).toBeGreaterThan(0);
    expect(planOut.versions![0]).toEqual(
      expect.objectContaining({
        rev: expect.any(Number),
        title: 'Plan',
        bodyMd: expect.any(String),
      }),
    );
    expect(out.notes.find((n) => n.id === kalman)!.tagIds).toHaveLength(1);
  });

  it('leaves versions out by default', async () => {
    const result = await runExport(opts({ format: 'json' }), () => {});
    const out = JSON.parse(strFromU8(unzip(result.file)['nexus.json']!)) as JsonExport;
    expect(out.notes.every((n) => n.versions === undefined)).toBe(true);
  });
});
