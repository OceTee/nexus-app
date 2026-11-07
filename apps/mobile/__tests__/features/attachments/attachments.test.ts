import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { repos } from '../../../src/data/repos';
import type { AttachmentRow } from '../../../src/data/rows';
import {
  addAttachment,
  AttachmentError,
  deleteAttachment,
  uploadPending,
} from '../../../src/features/attachments/attachments';
import { fileFor } from '../../../src/features/attachments/cache';
import { api, ApiError } from '../../../src/infra/apiClient';
import { setDbForTests } from '../../../src/infra/db';
import type { SqlDb } from '../../../src/infra/sql';
import { useSessionStore } from '../../../src/stores/session';
import { createTestDb } from '../../../src/test/nodeSqlite';
import { store } from '../fakeFileSystem';

jest.mock('expo-file-system', () => jest.requireActual('../fakeFileSystem'));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = api as jest.MockedFunction<typeof api>;
const getDocument = DocumentPicker.getDocumentAsync as jest.Mock;
const library = ImagePicker.launchImageLibraryAsync as jest.Mock;
const camera = ImagePicker.launchCameraAsync as jest.Mock;
const cameraPerm = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
const manipulate = ImageManipulator.manipulate as jest.Mock;

let db: SqlDb;

/** Puts a picked file in the fake file system and returns its uri. */
const pickedFile = (name: string, size = 100) => {
  const uri = `file:///picker/${name}`;
  store.files.set(uri, new Uint8Array(size));
  return uri;
};

const attachments = () =>
  db.getAllAsync<AttachmentRow>(`SELECT * FROM attachments ORDER BY created_at`);

const signIn = (emailVerified = true) =>
  useSessionStore.setState({
    status: 'authed',
    user: { id: 'u1', email: 'a@b.c', displayName: 'A', emailVerified },
  });

beforeEach(async () => {
  jest.clearAllMocks();
  store.reset();
  db = await createTestDb();
  setDbForTests(db);
  useSessionStore.setState({ status: 'local', user: null });
});

describe('addAttachment', () => {
  it('returns null when the picker is cancelled', async () => {
    getDocument.mockResolvedValue({ canceled: true, assets: null });
    expect(await addAttachment('n1', 'files')).toBeNull();
    library.mockResolvedValue({ canceled: true, assets: null });
    expect(await addAttachment('n1', 'library')).toBeNull();
  });

  it('stores a PDF as pending, caches it and links it from the note', async () => {
    const note = await repos.notes.save({ title: 'Paper', bodyMd: 'Intro' });
    getDocument.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: pickedFile('paper.pdf', 1234), name: 'a/b\u0001.pdf', mimeType: 'application/pdf' },
      ],
    });

    const row = await addAttachment(note.id, 'files');

    expect(row).toMatchObject({
      note_id: note.id,
      filename: 'a-b.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1234,
      status: 'pending',
    });
    expect(row!.sha256).toBe(`sha-of-${row!.id}.pdf`);
    expect((await attachments())[0]).toMatchObject({ id: row!.id, status: 'pending', dirty: 1 });
    expect(store.files.has(fileFor(row!).uri)).toBe(true);
    const cache = await db.getAllAsync(`SELECT attachment_id FROM attachment_cache`);
    expect(cache).toEqual([{ attachment_id: row!.id }]);
    expect((await repos.notes.get(note.id))!.bodyMd).toBe(
      `Intro\n\n[a-b.pdf](nexus://attachment/${row!.id})\n`,
    );
    // Not signed in: nothing is uploaded.
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('adds an image link to an empty note', async () => {
    const note = await repos.notes.save({ title: 'Photo', bodyMd: '' });
    library.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: pickedFile('p.png'),
          fileName: 'p.png',
          mimeType: 'image/png',
          width: 10,
          height: 20,
        },
      ],
    });
    const row = await addAttachment(note.id, 'library');
    expect(row).toMatchObject({ width: 10, height: 20 });
    expect((await repos.notes.get(note.id))!.bodyMd).toBe(
      `![p.png](nexus://attachment/${row!.id})\n`,
    );
  });

  it('defaults the type of an unknown document and rejects it', async () => {
    getDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: pickedFile('x'), name: 'x', mimeType: undefined }],
    });
    await expect(addAttachment('n1', 'files')).rejects.toThrow(
      'NEXUS can attach JPEG, PNG, WebP images and PDFs.',
    );
  });

  it('rejects files over 25 MB and removes the copy', async () => {
    getDocument.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: pickedFile('big.pdf', 26_214_401), name: 'big.pdf', mimeType: 'application/pdf' },
      ],
    });
    await expect(addAttachment('n1', 'files')).rejects.toBeInstanceOf(AttachmentError);
    expect([...store.files.keys()]).toEqual(['file:///picker/big.pdf']);
    expect(await attachments()).toEqual([]);
  });

  it('asks for camera permission first', async () => {
    cameraPerm.mockResolvedValue({ granted: false });
    await expect(addAttachment('n1', 'camera')).rejects.toThrow('Allow camera access');
    expect(camera).not.toHaveBeenCalled();
  });

  it('converts a large HEIC photo to a scaled JPEG', async () => {
    cameraPerm.mockResolvedValue({ granted: true });
    camera.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///picker/raw.heic',
          fileName: null,
          mimeType: 'image/heic',
          width: 3000,
          height: 4000,
        },
      ],
    });
    const resize = jest.fn();
    const saveAsync = jest.fn().mockResolvedValue({
      uri: pickedFile('out.jpg', 500),
      width: 1536,
      height: 2048,
    });
    manipulate.mockReturnValue({ resize, renderAsync: async () => ({ saveAsync }) });

    const row = await addAttachment('n1', 'camera');

    expect(manipulate).toHaveBeenCalledWith('file:///picker/raw.heic');
    expect(resize).toHaveBeenCalledWith({ height: 2048 });
    expect(saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.85 });
    expect(row).toMatchObject({
      mime_type: 'image/jpeg',
      width: 1536,
      height: 2048,
      size_bytes: 500,
    });
    expect(row!.filename).toMatch(/^photo-\d+\.jpg$/);
  });

  it('scales a wide accepted image by width', async () => {
    library.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///picker/wide.png',
          fileName: 'wide.png',
          mimeType: 'image/png',
          width: 5000,
          height: 100,
        },
      ],
    });
    const resize = jest.fn();
    manipulate.mockReturnValue({
      resize,
      renderAsync: async () => ({
        saveAsync: async () => ({ uri: pickedFile('wide.jpg'), width: 2048, height: 41 }),
      }),
    });
    const row = await addAttachment('n1', 'library');
    expect(resize).toHaveBeenCalledWith({ width: 2048 });
    expect(row!.filename).toBe('wide.jpg');
  });
});

describe('deleteAttachment', () => {
  it('removes the link, the local file and the cache row', async () => {
    const note = await repos.notes.save({ title: 'N', bodyMd: 'x' });
    getDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: pickedFile('d.pdf'), name: 'd.pdf', mimeType: 'application/pdf' }],
    });
    const row = (await addAttachment(note.id, 'files'))!;

    await deleteAttachment(row);

    expect((await repos.notes.get(note.id))!.bodyMd).toBe('x\n\n');
    expect(store.files.has(fileFor(row).uri)).toBe(false);
    expect(await db.getAllAsync(`SELECT * FROM attachment_cache`)).toEqual([]);
    expect((await attachments())[0]!.deleted_at).not.toBeNull();
  });
});

describe('uploadPending', () => {
  const insert = (over: Partial<AttachmentRow>) =>
    db.runAsync(
      `INSERT INTO attachments (id, note_id, filename, mime_type, size_bytes, sha256, status, width, height,
         server_rev, local_rev, dirty, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'f.png', 'image/png', 3, 'sha', ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [
        over.id!,
        over.note_id === undefined ? 'n1' : over.note_id,
        over.status ?? 'pending',
        over.width ?? null,
        over.height ?? null,
        over.server_rev ?? 0,
        over.created_at ?? '2026-01-01',
        '2026-01-01',
        over.deleted_at ?? null,
      ],
    );
  const onDisk = (id: string) =>
    store.files.set(fileFor({ id, mime_type: 'image/png' }).uri, new Uint8Array(3));
  const complete = { status: 'uploaded', serverRev: 4, updatedAt: '2026-02-02' };

  it('does nothing unless signed in with a verified email', async () => {
    await insert({ id: 'a' });
    await uploadPending();
    signIn(false);
    await uploadPending();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('creates, uploads and completes a pending attachment', async () => {
    signIn();
    await insert({ id: 'a', width: 10, height: 20 });
    onDisk('a');
    mockApi.mockImplementation(async (path: string) =>
      path === '/v1/attachments'
        ? { upload: { url: 'https://s3/put', headers: { 'x-h': '1' } } }
        : complete,
    );

    await uploadPending();

    expect(mockApi).toHaveBeenNthCalledWith(1, '/v1/attachments', {
      method: 'POST',
      body: expect.objectContaining({ id: 'a', noteId: 'n1', width: 10, height: 20 }),
    });
    expect(store.uploads).toEqual([
      expect.objectContaining({
        url: 'https://s3/put',
        options: expect.objectContaining({ httpMethod: 'PUT' }),
      }),
    ]);
    expect(mockApi).toHaveBeenNthCalledWith(2, '/v1/attachments/a/complete', { method: 'POST' });
    expect((await attachments())[0]).toMatchObject({ status: 'uploaded', server_rev: 4, dirty: 0 });
  });

  it('skips the upload when the server already has the record (409)', async () => {
    signIn();
    await insert({ id: 'a' });
    onDisk('a');
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/v1/attachments') throw new ApiError(409, 'CONFLICT', 'exists');
      return complete;
    });
    await uploadPending();
    expect(store.uploads).toEqual([]);
    expect((await attachments())[0]).toMatchObject({ dirty: 0 });
  });

  it('leaves the row pending when the PUT fails', async () => {
    signIn();
    await insert({ id: 'a' });
    onDisk('a');
    store.uploadStatus = 500;
    mockApi.mockResolvedValue({ upload: { url: 'u', headers: {} } });
    await uploadPending();
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect((await attachments())[0]).toMatchObject({ status: 'pending', dirty: 1 });
  });

  it('skips rows without a note or without a local file', async () => {
    signIn();
    await insert({ id: 'nonote', note_id: null });
    await insert({ id: 'nofile' });
    await uploadPending();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('sends deletes for uploaded attachments, ignoring 404, and drops the rows', async () => {
    signIn();
    await insert({ id: 'up', status: 'uploaded', server_rev: 2, deleted_at: '2026-03-03' });
    await insert({ id: 'gone', status: 'uploaded', server_rev: 2, deleted_at: '2026-03-03' });
    await insert({ id: 'local', deleted_at: '2026-03-03' });
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/v1/attachments/gone') throw new ApiError(404, 'NOT_FOUND', 'gone');
      return undefined;
    });
    await uploadPending();
    expect(mockApi.mock.calls.map((c) => c[0])).toEqual([
      '/v1/attachments/up',
      '/v1/attachments/gone',
    ]);
    expect(await attachments()).toEqual([]);
  });

  it('stops the pass when offline', async () => {
    signIn();
    await insert({ id: 'a', created_at: '2026-01-01' });
    await insert({ id: 'b', created_at: '2026-01-02' });
    onDisk('a');
    onDisk('b');
    mockApi.mockRejectedValue(new ApiError(0, 'NETWORK', 'offline'));
    await uploadPending();
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it('runs one pass at a time', async () => {
    signIn();
    await insert({ id: 'a' });
    const first = uploadPending();
    expect(uploadPending()).toBe(first);
    await first;
  });
});
