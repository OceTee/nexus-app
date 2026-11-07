// Imported before expo-router/testing-library on purpose: that module re-mocks Reanimated
// (to an empty object here, as its own mock cannot load without native worklets), and the
// viewer must bind to the stand-in mocked below instead.
import AttachmentViewer from '../../../app/(app)/attachment/[attachmentId]';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as Sharing from 'expo-sharing';
import { Text } from 'react-native';
import AttachmentPicker from '../../../app/(app)/attachment/pick';
import { repos } from '../../../src/data/repos';
import type { AttachmentRow } from '../../../src/data/rows';
import { fileFor, isPinned, recordCached } from '../../../src/features/attachments/cache';
import { api } from '../../../src/infra/apiClient';
import type { SqlDb } from '../../../src/infra/sql';
import { useSessionStore } from '../../../src/stores/session';
import { store } from '../../features/fakeFileSystem';
import { lastGesture } from '../notes-helpers/gestureHandler';
import { freshDb, toastMessage } from '../notes-helpers/setup';

// In-memory expo-file-system, plus the system viewer the PDF "Open" button uses.
jest.mock('expo-file-system', () => {
  const fake = jest.requireActual('../../features/fakeFileSystem');
  fake.File.prototype.preview = jest.fn();
  return fake;
});
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
// The zoomable image animates with Reanimated worklets, and the gesture detector attaches
// natively; stand both in with plain JS. The captured gesture lets tests drive the zoom.
jest.mock('react-native-reanimated', () => jest.requireActual('../notes-helpers/reanimated'));
jest.mock('react-native-gesture-handler', () =>
  jest.requireActual('../notes-helpers/gestureHandler'),
);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
// Downloads of attachments not cached on this device go through the API.
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const getDocument = jest.mocked(DocumentPicker.getDocumentAsync);
const library = jest.mocked(ImagePicker.launchImageLibraryAsync);
const cameraPerm = jest.mocked(ImagePicker.requestCameraPermissionsAsync);
const preview = (File.prototype as unknown as { preview: jest.Mock }).preview;
const mockApi = jest.mocked(api);

let db: SqlDb;

/** Starts on a home stub and pushes `path`, so router.back() has somewhere to go. */
async function open(path: string, routes: Record<string, () => React.ReactElement | null>) {
  await renderRouter({ home: () => <Text>Home screen</Text>, ...routes }, { initialUrl: '/home' });
  await act(async () => router.push(path as never));
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockApi.mockReset();
  store.reset();
  db = await freshDb();
  useSessionStore.setState({ status: 'local', user: null });
});

describe('Attachment picker', () => {
  let noteId: string;
  const openPicker = () =>
    open(`/attachment/pick?noteId=${noteId}`, { 'attachment/pick': AttachmentPicker });

  beforeEach(async () => {
    noteId = (await repos.notes.save({ title: 'N', bodyMd: 'Body' })).id;
  });

  it('lists the three sources with hints', async () => {
    await openPicker();
    expect(await screen.findByRole('button', { name: 'Take a photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Photo library' }).props.accessibilityHint).toBe(
      'JPEG, PNG, WebP or HEIC',
    );
    expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy();
  });

  it('attaches a PDF from Files and goes back', async () => {
    const uri = 'file:///picker/paper.pdf';
    store.files.set(uri, new Uint8Array(10));
    getDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri, name: 'paper.pdf', mimeType: 'application/pdf' }],
    } as never);
    await openPicker();
    await fireEvent.press(await screen.findByRole('button', { name: 'Files' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(toastMessage()).toBe('Attached paper.pdf');
    expect((await repos.notes.get(noteId))?.bodyMd).toMatch(
      /^Body\n\n\[paper\.pdf\]\(nexus:\/\/attachment\/.+\)\n$/,
    );
  });

  it('stays open when the picker is cancelled', async () => {
    library.mockResolvedValue({ canceled: true, assets: null });
    await openPicker();
    await fireEvent.press(await screen.findByRole('button', { name: 'Photo library' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Photo library' }).props.accessibilityState.disabled,
      ).toBe(false),
    );
    expect(toastMessage()).toBeNull();
    expect(screen.queryByText('Home screen')).toBeNull();
  });

  it('explains a refused camera, and an unexpected failure', async () => {
    cameraPerm.mockResolvedValue({ granted: false } as never);
    await openPicker();
    await fireEvent.press(await screen.findByRole('button', { name: 'Take a photo' }));
    await waitFor(() => expect(toastMessage()).toMatch(/Allow camera access/));
    getDocument.mockRejectedValue(new Error('crashed'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Files' }).props.accessibilityState.disabled).toBe(
        false,
      ),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Files' }));
    await waitFor(() => expect(toastMessage()).toBe('Could not attach that file'));
  });
});

describe('Attachment viewer', () => {
  const viewer = { 'attachment/[attachmentId]': AttachmentViewer };

  /** An attachment row, optionally with its bytes cached on this device. */
  async function seed(
    id: string,
    over: Partial<AttachmentRow> & { cached?: boolean; noteId?: string } = {},
  ) {
    const { cached = true, noteId = null, ...row } = over;
    const a = {
      mime_type: 'image/png',
      filename: `${id}.png`,
      status: 'uploaded',
      width: null,
      height: null,
      ...row,
    };
    await db.runAsync(
      `INSERT INTO attachments (id, note_id, filename, mime_type, size_bytes, sha256, status, width, height,
         created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 2048, 'sha', ?, ?, ?, 'x', 'x', ?)`,
      [id, noteId, a.filename, a.mime_type, a.status, a.width, a.height, row.deleted_at ?? null],
    );
    if (cached) {
      const f = fileFor({ id, mime_type: a.mime_type });
      store.files.set(f.uri, new Uint8Array(2048));
      await recordCached(id, f as never, 2048);
    }
  }

  it('says when an attachment was deleted', async () => {
    await seed('gone', { deleted_at: '2026-01-01' });
    await open('/attachment/gone', viewer);
    expect(await screen.findByText('This attachment was deleted')).toBeTruthy();
  });

  it('explains an attachment that is not on this device while offline', async () => {
    await seed('far', { cached: false });
    mockApi.mockRejectedValue(new Error('offline'));
    await open('/attachment/far', viewer);
    expect(await screen.findByText('Not on this device yet')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'far.png' })).toBeTruthy();
  });

  it('shows an image with its size and pending state', async () => {
    await seed('img', { width: 640, height: 480, status: 'pending' });
    await open('/attachment/img', viewer);
    expect(await screen.findByLabelText('img.png')).toBeTruthy();
    expect(screen.getByText('2 KB · 640 × 480 · waiting to upload')).toBeTruthy();
  });

  it('zooms an image by pinch, pan and double-tap', async () => {
    await seed('img');
    await open('/attachment/img', viewer);
    expect(await screen.findByLabelText('img.png')).toBeTruthy();
    const [pinch, pan, tap] = lastGesture()!.gestures!.map((g) => g.handlers);
    // Panning does nothing until zoomed in.
    pan!.onUpdate!({ translationX: 10, translationY: 5 });
    pinch!.onUpdate!({ scale: 3 });
    pinch!.onEnd!();
    pan!.onUpdate!({ translationX: 10, translationY: 5 });
    pan!.onEnd!();
    tap!.onEnd!(); // zoomed in: back to 1x
    tap!.onEnd!(); // 1x: to 2x
    pinch!.onUpdate!({ scale: 0.1 });
    pinch!.onEnd!(); // pinched below 1x: snaps back to the centre
    expect(screen.getByLabelText('img.png').props.accessibilityHint).toBe(
      'Pinch or double-tap to zoom',
    );
  });

  it('opens a PDF in the system viewer, falling back to Share', async () => {
    await seed('doc', { mime_type: 'application/pdf', filename: 'doc.pdf' });
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
    await open('/attachment/doc', viewer);
    expect(await screen.findByText('PDF · 2 KB')).toBeTruthy();
    preview.mockResolvedValueOnce(undefined);
    await fireEvent.press(screen.getByRole('button', { name: 'Open' }));
    expect(preview).toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    preview.mockRejectedValueOnce(new Error('no viewer'));
    await fireEvent.press(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringMatching(/doc\.pdf$/), {
        mimeType: 'application/pdf',
        dialogTitle: 'doc.pdf',
      }),
    );
  });

  it('shares from the menu, or explains that sharing is unavailable', async () => {
    await seed('img');
    await open('/attachment/img', viewer);
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(true);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Share' }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    await fireEvent.press(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Share' }));
    await waitFor(() => expect(toastMessage()).toBe('Sharing is not available on this device'));
  });

  it('keeps an attachment offline and releases it again', async () => {
    await seed('img');
    await open('/attachment/img', viewer);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Keep offline' }));
    await waitFor(() => expect(toastMessage()).toBe('Kept on this device'));
    expect(await isPinned('img')).toBe(true);
    expect(await screen.findByText('2 KB · kept offline')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Stop keeping offline' }));
    await waitFor(() => expect(toastMessage()).toBe('Can be cleared to save space'));
    expect(await isPinned('img')).toBe(false);
  });

  it('deletes after confirming and removes the link from the note', async () => {
    const note = await repos.notes.save({
      title: 'N',
      bodyMd: 'See ![pic](nexus://attachment/img)\n',
    });
    await seed('img', { noteId: note.id });
    await open('/attachment/img', viewer);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText('Delete this attachment?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(toastMessage()).toBe('Attachment deleted');
    expect((await repos.notes.get(note.id))?.bodyMd).toBe('See ');
  });
});
