import type { NoteVersionDetailDto, NoteVersionDto } from '@nexus/shared';
import { useLocalSearchParams } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';
import VersionDetail from '../../../app/(app)/note/[noteId]/versions/[versionId]';
import Versions from '../../../app/(app)/note/[noteId]/versions/index';
import { repos } from '../../../src/data/repos';
import { useSyncStore } from '../../../src/data/sync';
import { api } from '../../../src/infra/apiClient';
import type { SqlDb } from '../../../src/infra/sql';
import { useSessionStore } from '../../../src/stores/session';
import { freshDb, queryWrapper, scrollViewOf, toastMessage } from '../notes-helpers/setup';

jest.mock('marked', () =>
  jest.requireActual('../../../../../node_modules/marked/lib/marked.umd.js'),
);
// Server versions come from the API; keep ApiError real and script api() per test.
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = jest.mocked(api);

function DetailStub() {
  const { versionId, source } = useLocalSearchParams<{ versionId: string; source: string }>();
  return <Text>{`Detail ${versionId} ${source}`}</Text>;
}
function EditorStub() {
  return <Text>Editor screen</Text>;
}

let db: SqlDb;

const serverVersion = (over: Partial<NoteVersionDto> = {}): NoteVersionDto => ({
  id: 's1',
  rev: 5,
  baseRev: 4,
  conflict: false,
  resolvedAt: null,
  deviceName: 'Laptop',
  wordCount: 3,
  createdAt: '2026-01-01T10:00:00.000Z',
  ...over,
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockApi.mockReset();
  db = await freshDb();
  useSessionStore.setState({ status: 'local' });
  useSyncStore.setState({ online: null });
});

describe('Version history', () => {
  const open = (id: string) =>
    renderRouter(
      {
        'note/[noteId]/versions/index': Versions,
        'note/[noteId]/versions/[versionId]': DetailStub,
      },
      { initialUrl: `/note/${id}/versions`, wrapper: queryWrapper() },
    );

  it('shows an empty state without versions', async () => {
    await open('nothing');
    expect(await screen.findByText('No versions yet')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('lists local versions with word deltas and opens one', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'one' });
    await repos.notes.save({ id: n.id, title: 'T', bodyMd: 'one two three' });
    const [newest] = await repos.versions.local(n.id);
    await open(n.id);
    expect(await screen.findByText('This device · +2 words')).toBeTruthy();
    expect(screen.getByText('This device · +1 word')).toBeTruthy();
    expect(screen.getByText('Sign in to see versions from other devices.')).toBeTruthy();
    await fireEvent.press(screen.getByText(/^Revision 2/));
    expect(await screen.findByText(`Detail ${newest!.id} local`)).toBeTruthy();
  });

  it('marks a conflicted copy', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'a' });
    await db.runAsync(
      `INSERT INTO note_versions_local (id, note_id, rev, base_rev, title, body_md, conflict, source, created_at)
       VALUES ('mine', ?, 9, 1, 'T', 'a', 1, 'conflict', '2099-01-01T00:00:00.000Z')`,
      [n.id],
    );
    await open(n.id);
    expect(await screen.findByText('Conflicted copy')).toBeTruthy();
    expect(screen.getByText('This device (conflicted copy) · ±0 words')).toBeTruthy();
  });

  it('says older versions need a connection when signed in but offline', async () => {
    useSessionStore.setState({ status: 'authed' });
    useSyncStore.setState({ online: false });
    const n = await repos.notes.save({ title: 'T', bodyMd: 'a' });
    await open(n.id);
    expect(await screen.findByText('Older versions are available when online.')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('merges server versions with unsynced local edits, and pages', async () => {
    useSessionStore.setState({ status: 'authed' });
    useSyncStore.setState({ online: true });
    const n = await repos.notes.save({ title: 'T', bodyMd: 'a b c d' });
    // An older local copy the server already has.
    await db.runAsync(
      `INSERT INTO note_versions_local (id, note_id, rev, base_rev, title, body_md, conflict, source, created_at)
       VALUES ('old', ?, 1, 0, 'T', 'a', 0, 'local', '2020-01-01T00:00:00.000Z')`,
      [n.id],
    );
    mockApi
      .mockResolvedValueOnce({
        items: [
          serverVersion({ id: 's3', rev: 3, wordCount: 3, deviceName: null }),
          serverVersion({ id: 's2', rev: 2, wordCount: 4, conflict: true }),
          serverVersion({ id: 's1', rev: 1, wordCount: 4 }),
        ],
        hasMore: true,
        nextCursor: 'c 1',
      })
      .mockResolvedValueOnce({
        items: [serverVersion({ id: 's0', rev: 0 + 1, wordCount: 1 })],
        hasMore: false,
        nextCursor: null,
      });
    await open(n.id);
    const row = await screen.findByText('Another device · −1 word', {}, { timeout: 3000 });
    expect(screen.getByText('Laptop · ±0 words')).toBeTruthy();
    expect(screen.getByText('Laptop · +4 words')).toBeTruthy();
    expect(screen.getByText(/This device \(not synced yet\)/)).toBeTruthy();
    // The 2020 local copy is older than the server's newest version, so it is hidden.
    expect(screen.getAllByText(/^Revision 1 ·/)).toHaveLength(2);
    expect(mockApi).toHaveBeenCalledWith(`/v1/notes/${n.id}/versions?limit=50`);

    // Jest's ScrollView mock keeps the list's props on the host view.
    await fireEvent(scrollViewOf(row), 'endReached');
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(`/v1/notes/${n.id}/versions?limit=50&cursor=c%201`),
    );
    await fireEvent.press(screen.getByText('Another device · −1 word'));
    expect(await screen.findByText('Detail s3 server')).toBeTruthy();
  });

  it('refreshes server versions on pull', async () => {
    useSessionStore.setState({ status: 'authed' });
    useSyncStore.setState({ online: true });
    const n = await repos.notes.save({ title: 'T', bodyMd: 'a' });
    mockApi.mockResolvedValue({ items: [serverVersion()], hasMore: false, nextCursor: null });
    await open(n.id);
    const row = await screen.findByText('Laptop · +3 words', {}, { timeout: 3000 });
    // The list's ScrollView renders its RefreshControl as a host child; pull it.
    const refresh = scrollViewOf(row).children.find(
      (c) => typeof c !== 'string' && c.type === 'RCTRefreshControl',
    );
    await fireEvent(refresh as never, 'refresh');
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(2));
  });
});

describe('Version detail', () => {
  const routes = {
    'note/[noteId]/versions/[versionId]': VersionDetail,
    'note/[noteId]/index': EditorStub,
  };
  const open = (noteId: string, versionId: string, source?: string) =>
    renderRouter(routes, {
      initialUrl: `/note/${noteId}/versions/${versionId}${source ? `?source=${source}` : ''}`,
      wrapper: queryWrapper(),
    });

  it('shows a local version, its changes, and restores it', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'first line' });
    const [old] = await repos.versions.local(n.id);
    await repos.notes.save({ id: n.id, title: 'T', bodyMd: 'first line\nsecond line' });
    await open(n.id, old!.id, 'local');
    expect(await screen.findByRole('header', { name: 'Revision 1' })).toBeTruthy();
    expect(screen.getByText('first line')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Changes' }));
    expect(screen.getByText('Compared with the note as it is now.')).toBeTruthy();
    expect(screen.getByLabelText('Only in the current note: second line')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Restore this version' }));
    expect(screen.getByText('Restore this version?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Editor screen')).toBeTruthy();
    expect((await repos.notes.get(n.id))?.bodyMd).toBe('first line');
    expect(toastMessage()).toBe('Restored revision 1');
  });

  it('shows added lines and disables restoring the current text', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'a\nb' });
    const [cur] = await repos.versions.local(n.id);
    await open(n.id, cur!.id);
    const btn = await screen.findByRole('button', { name: 'This is the current text' });
    expect(btn.props.accessibilityState.disabled).toBe(true);
    await repos.notes.save({ id: n.id, title: 'T', bodyMd: 'a' });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Changes' }));
    expect(await screen.findByLabelText('In this version: b')).toBeTruthy();
    expect(screen.getByLabelText('a')).toBeTruthy();
  });

  it('loads a server version', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'now' });
    const detail: NoteVersionDetailDto = {
      ...serverVersion({ rev: 7 }),
      title: 'Old T',
      bodyMd: 'server text',
    };
    mockApi.mockResolvedValueOnce(detail);
    await open(n.id, 's1', 'server');
    expect(await screen.findByRole('header', { name: 'Revision 7' })).toBeTruthy();
    expect(screen.getByText('server text')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith(`/v1/notes/${n.id}/versions/s1`);
  });

  it('explains an unavailable server version and retries', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'now' });
    mockApi.mockRejectedValueOnce(new Error('offline'));
    await open(n.id, 's1', 'server');
    expect(await screen.findByText('This version is not available')).toBeTruthy();
    mockApi.mockResolvedValueOnce({ ...serverVersion({ rev: 8 }), title: 'T', bodyMd: 'b' });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: 'Revision 8' })).toBeTruthy();
  });

  it('explains a missing local version', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'now' });
    await open(n.id, 'gone');
    expect(await screen.findByText('This version is not available')).toBeTruthy();
  });
});
