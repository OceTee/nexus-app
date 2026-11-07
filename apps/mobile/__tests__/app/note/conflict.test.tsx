import type { NoteDto } from '@nexus/shared';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';
import ConflictScreen from '../../../app/(app)/note/[noteId]/conflict';
import { repos } from '../../../src/data/repos';
import { ApiError, api } from '../../../src/infra/apiClient';
import type { SqlDb } from '../../../src/infra/sql';
import { freshDb, toastMessage } from '../notes-helpers/setup';

jest.mock('marked', () =>
  jest.requireActual('../../../../../node_modules/marked/lib/marked.umd.js'),
);
// resolveConflict runs for real; only its server call is scripted.
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = jest.mocked(api);
const NOTE = 'note-1';
const T0 = '2026-01-01T09:30:00.000Z';
let db: SqlDb;

/** A synced note (server rev 3) with this device's losing copy stored as version `mine`. */
async function seed({ dirty = false, mine = true }: { dirty?: boolean; mine?: boolean } = {}) {
  await db.runAsync(
    `INSERT INTO notes (id, title, title_norm, body_md, server_rev, local_rev, dirty, created_at, updated_at)
     VALUES (?, 'Plan', 'plan', 'Server para', 3, 1, ?, ?, ?)`,
    [NOTE, dirty ? 1 : 0, T0, T0],
  );
  if (mine) {
    await db.runAsync(
      `INSERT INTO note_versions_local (id, note_id, rev, base_rev, title, body_md, conflict, source, created_at)
       VALUES ('mine', ?, 1, 2, 'Plan', 'Server para\n\nMy para', 1, 'conflict', ?)`,
      [NOTE, T0],
    );
  }
  await db.runAsync(
    `INSERT INTO conflicts (id, note_id, version_id, server_rev, device_name, created_at)
     VALUES ('c1', ?, 'mine', 3, ?, ?)`,
    [NOTE, mine ? 'Laptop' : null, T0],
  );
}

const serverNote = (over: Partial<NoteDto> = {}): NoteDto => ({
  id: NOTE,
  title: 'Plan',
  bodyMd: 'Resolved',
  excerpt: '',
  collectionId: null,
  isPinned: false,
  wordCount: 1,
  serverRev: 4,
  tagIds: [],
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...over,
});

/** Opens the editor stub, then the conflict screen on top, so Back has somewhere to go. */
async function open() {
  await renderRouter(
    {
      'note/[noteId]/index': () => <Text>Editor screen</Text>,
      'note/[noteId]/conflict': ConflictScreen,
    },
    { initialUrl: `/note/${NOTE}` },
  );
  await act(async () => router.push(`/note/${NOTE}/conflict`));
}

const body = async () => (await repos.notes.get(NOTE))?.bodyMd;
const openConflicts = () => repos.conflicts.open(NOTE);

beforeEach(async () => {
  mockApi.mockReset();
  db = await freshDb();
});

describe('Conflict screen', () => {
  it('compares both copies', async () => {
    await seed();
    await open();
    expect(await screen.findByRole('header', { name: 'Resolve conflict' })).toBeTruthy();
    expect(screen.getByText(/Edited on Laptop at .* and on this device at/)).toBeTruthy();
    expect(screen.getByText('ON SERVER')).toBeTruthy();
    expect(screen.getByText('THIS DEVICE')).toBeTruthy();
    expect(screen.getByText('My para')).toBeTruthy();
  });

  it('keeps the server copy through the server', async () => {
    await seed();
    mockApi.mockResolvedValueOnce(serverNote());
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Keep server' }));
    expect(await screen.findByText('Editor screen')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith(`/v1/notes/${NOTE}/conflicts/mine/resolve`, {
      method: 'POST',
      body: { strategy: 'keep_server', baseRev: 3 },
    });
    expect(await body()).toBe('Resolved');
    expect(await openConflicts()).toEqual([]);
    expect(toastMessage()).toBe('Kept the server copy');
  });

  it('keeps my copy locally when there are unsent edits', async () => {
    await seed({ dirty: true });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Keep mine' }));
    expect(await screen.findByText('Editor screen')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
    expect(await body()).toBe('Server para\n\nMy para');
    expect(toastMessage()).toBe('Kept your copy');
  });

  it('merges: edit the draft, go back, then save it', async () => {
    await seed();
    mockApi.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Merge' }));
    const field = screen.getByLabelText('Merged text');
    expect(field.props.value).toBe('Server para\n\n---\n\nMy para\n');

    await fireEvent.press(screen.getByRole('button', { name: 'Back to comparison' }));
    expect(screen.getByText('ON SERVER')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Merge' }));
    await fireEvent.changeText(screen.getByLabelText('Merged text'), 'Both paras');
    await fireEvent.press(screen.getByRole('button', { name: 'Save merged note' }));
    expect(await screen.findByText('Editor screen')).toBeTruthy();
    // Offline: the merge is written locally and syncs later.
    expect(await body()).toBe('Both paras');
    expect(await openConflicts()).toEqual([]);
    expect(toastMessage()).toBe('Merged');
  });

  it('reports a failure and stays', async () => {
    await seed();
    mockApi.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Keep server' }));
    await waitFor(() => expect(toastMessage()).toBe('Could not resolve the conflict. Try again.'));
    expect(screen.getByRole('button', { name: 'Keep server' })).toBeTruthy();
    expect(await openConflicts()).toHaveLength(1);
  });

  it('cannot keep a copy that is gone, and names no device', async () => {
    await seed({ mine: false });
    await open();
    const keepMine = await screen.findByRole('button', { name: 'Keep mine' });
    expect(keepMine.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/Edited on another device at/)).toBeTruthy();
  });

  it('says when the conflict is already resolved, and goes back', async () => {
    await seed();
    await repos.conflicts.resolveNote(NOTE);
    await open();
    expect(await screen.findByText('Already resolved')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the note' }));
    expect(await screen.findByText('Editor screen')).toBeTruthy();
  });

  it('decides later with the back button', async () => {
    await seed();
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Decide later' }));
    expect(await screen.findByText('Editor screen')).toBeTruthy();
    expect(await openConflicts()).toHaveLength(1);
  });
});
