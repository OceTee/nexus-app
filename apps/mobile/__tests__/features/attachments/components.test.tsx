import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useSyncStore } from '../../../src/data/sync';
import { uploadPending } from '../../../src/features/attachments/attachments';
import { AttachmentImage } from '../../../src/features/attachments/AttachmentImage';
import { AttachmentStrip } from '../../../src/features/attachments/AttachmentStrip';
import { useAttachment } from '../../../src/features/attachments/useAttachment';
import { useAttachmentUploads } from '../../../src/features/attachments/useAttachmentUploads';
import { api, ApiError } from '../../../src/infra/apiClient';
import { setDbForTests } from '../../../src/infra/db';
import type { SqlDb } from '../../../src/infra/sql';
import { createTestDb } from '../../../src/test/nodeSqlite';
import { store } from '../fakeFileSystem';

jest.mock('expo-file-system', () => jest.requireActual('../fakeFileSystem'));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));
jest.mock('../../../src/features/attachments/attachments', () => ({
  uploadPending: jest.fn(),
}));

const mockApi = api as jest.MockedFunction<typeof api>;
let db: SqlDb;

const insert = (
  id: string,
  over: { status?: string; mime?: string; deleted?: boolean; w?: number; h?: number } = {},
) =>
  db.runAsync(
    `INSERT INTO attachments (id, note_id, filename, mime_type, size_bytes, sha256, status, width, height,
       created_at, updated_at, deleted_at)
     VALUES (?, 'n1', ?, ?, 3, 'sha', ?, ?, ?, ?, 'x', ?)`,
    [
      id,
      `${id}.file`,
      over.mime ?? 'image/png',
      over.status ?? 'uploaded',
      over.w ?? null,
      over.h ?? null,
      `2026-01-0${id.length}`,
      over.deleted ? '2026-02-01' : null,
    ],
  );

beforeEach(async () => {
  jest.clearAllMocks();
  store.reset();
  db = await createTestDb();
  setDbForTests(db);
});

describe('useAttachment', () => {
  it('is missing for an unknown or deleted attachment', async () => {
    await insert('del', { deleted: true });
    const unknown = await renderHook(() => useAttachment('nope'));
    await waitFor(() => expect(unknown.result.current).toEqual({ kind: 'missing' }));
    const deleted = await renderHook(() => useAttachment('del'));
    await waitFor(() => expect(deleted.result.current).toEqual({ kind: 'missing' }));
  });

  it('is ready once downloaded, or offline when that fails', async () => {
    await insert('a');
    mockApi.mockResolvedValueOnce({ url: 'https://s3/a', expiresAt: 'x' });
    const ready = await renderHook(() => useAttachment('a'));
    await waitFor(() => expect(ready.result.current.kind).toBe('ready'));

    await insert('b');
    mockApi.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'));
    const offline = await renderHook(() => useAttachment('b'));
    await waitFor(() => expect(offline.result.current.kind).toBe('offline'));
  });
});

describe('AttachmentImage', () => {
  it('shows a placeholder when offline or missing', async () => {
    await insert('b');
    mockApi.mockRejectedValue(new Error('offline'));
    const onPress = jest.fn();
    await render(<AttachmentImage id="b" onPress={onPress} />);
    await fireEvent.press(await screen.findByText('Image available when online'));
    expect(onPress).toHaveBeenCalled();

    await render(<AttachmentImage id="missing" onPress={onPress} />);
    expect(await screen.findByText('Image missing')).toBeTruthy();
  });

  it('shows the image when it is available', async () => {
    await insert('a', { w: 400, h: 300 });
    mockApi.mockResolvedValue({ url: 'https://s3/a', expiresAt: 'x' });
    const onPress = jest.fn();
    await render(<AttachmentImage id="a" onPress={onPress} />);
    await fireEvent.press(await screen.findByLabelText('a.file'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('AttachmentStrip', () => {
  it('renders nothing for a note without attachments', async () => {
    await render(<AttachmentStrip noteId="n1" />);
    await waitFor(() => expect(screen.toJSON()).toBeNull());
  });

  it('lists attachments, marks pending uploads and opens the viewer', async () => {
    await insert('a');
    await insert('bb', { status: 'pending' });
    await insert('ccc', { mime: 'application/pdf' });
    await render(<AttachmentStrip noteId="n1" />);
    expect(await screen.findByLabelText('a.file')).toBeTruthy();
    expect(screen.getByLabelText('bb.file, waiting to upload')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('ccc.file'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/attachment/[attachmentId]',
      params: { attachmentId: 'ccc' },
    });
  });
});

describe('useAttachmentUploads', () => {
  it('uploads after a sync run finishes, and stops listening on unmount', async () => {
    const { unmount } = await renderHook(() => useAttachmentUploads());
    await act(async () => useSyncStore.getState().set({ state: { kind: 'running', batch: 1 } }));
    expect(uploadPending).not.toHaveBeenCalled();
    await act(async () => useSyncStore.getState().set({ state: { kind: 'idle' } }));
    expect(uploadPending).toHaveBeenCalledTimes(1);
    // idle → idle is not the end of a run
    await act(async () => useSyncStore.getState().set({ state: { kind: 'idle' } }));
    expect(uploadPending).toHaveBeenCalledTimes(1);

    await unmount();
    await act(async () => useSyncStore.getState().set({ state: { kind: 'running', batch: 1 } }));
    await act(async () => useSyncStore.getState().set({ state: { kind: 'idle' } }));
    expect(uploadPending).toHaveBeenCalledTimes(1);
  });
});
