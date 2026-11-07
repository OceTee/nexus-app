import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import NotesList from '../../../app/(app)/(tabs)/notes/index';
import { repos } from '../../../src/data/repos';
import { runSync } from '../../../src/data/sync/engine';
import { useSyncStore } from '../../../src/data/sync/store';
import { useSessionStore } from '../../../src/stores/session';
import {
  freshDb,
  pullToRefresh,
  renderScreen,
  resetStores,
  signInAs,
  stub,
} from '../screen-helpers/setup';

jest.mock('@shopify/flash-list', () => jest.requireActual('../screen-helpers/flashListMock'));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () =>
  jest.requireActual('../screen-helpers/swipeableMock'),
);
jest.mock('../../../src/data/sync/engine', () => ({
  ...jest.requireActual('../../../src/data/sync/engine'),
  runSync: jest.fn(),
}));

const mockRunSync = runSync as jest.MockedFunction<typeof runSync>;

const routes = {
  notes: NotesList,
  'note/new': stub('New note'),
  'note/[noteId]': stub('Note'),
  settings: stub('Settings'),
  'settings/sync': stub('Sync'),
  'sign-in': stub('Sign in'),
};
const show = () => renderScreen(routes, '/notes');

beforeEach(async () => {
  jest.clearAllMocks();
  resetStores();
  await freshDb();
  mockRunSync.mockResolvedValue({ kind: 'ok', batches: 1 });
});

describe('Notes tab', () => {
  it('lists the notes on this device and opens one', async () => {
    await repos.notes.save({ title: 'Kalman filter', bodyMd: 'state estimation' });
    await repos.notes.save({ title: 'Reading list', bodyMd: '' });
    const r = await show();
    expect(await screen.findByText('Kalman filter')).toBeTruthy();
    expect(screen.getByText('Reading list')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Notes' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Kalman filter/ }));
    expect(await screen.findByText('Note screen')).toBeTruthy();
    expect(r.getPathname()).toMatch(/^\/note\//);
  });

  it('offers a first note when the list is empty', async () => {
    await show();
    expect(await screen.findByText('No notes yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Write your first note' }));
    expect(await screen.findByText('New note screen')).toBeTruthy();
  });

  it('opens a new note from the floating button', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'New note' }));
    expect(await screen.findByText('New note screen')).toBeTruthy();
  });

  it('filters to pinned and recent notes', async () => {
    const pinned = await repos.notes.save({ title: 'Pinned idea', bodyMd: '' });
    await repos.notes.setPinned(pinned.id, true);
    await repos.notes.save({ title: 'Loose thought', bodyMd: '' });
    await show();
    await screen.findByText('Loose thought');

    await fireEvent.press(screen.getByRole('tab', { name: 'Pinned' }));
    await waitFor(() => expect(screen.queryByText('Loose thought')).toBeNull());
    expect(screen.getByText('Pinned idea')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Recent' }));
    expect(await screen.findByText('Loose thought')).toBeTruthy();
  });

  it('explains empty pinned and recent views', async () => {
    await show();
    await screen.findByText('No notes yet');
    await fireEvent.press(screen.getByRole('tab', { name: 'Pinned' }));
    expect(await screen.findByText('No pinned notes')).toBeTruthy();
    expect(screen.getByText('Swipe right on a note to pin it.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Recent' }));
    expect(await screen.findByText('Nothing edited recently')).toBeTruthy();
  });
});

describe('Notes tab sync pill', () => {
  it('reads "Saved on this device" offline-only and opens Settings', async () => {
    await show();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Sync status: Saved on this device' }),
    );
    expect(await screen.findByText('Settings screen')).toBeTruthy();
  });

  it('reads "Synced" when signed in with nothing queued, and opens sync details', async () => {
    signInAs();
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sync status: Synced' }));
    expect(await screen.findByText('Sync screen')).toBeTruthy();
  });

  it('counts queued changes while signed in', async () => {
    signInAs();
    await repos.notes.save({ title: 'Queued', bodyMd: '' });
    await show();
    expect(await screen.findByRole('button', { name: 'Sync status: 1 to sync' })).toBeTruthy();
  });

  it('asks to sign in again when the session expired', async () => {
    useSessionStore.setState({ status: 'local', sessionExpired: true });
    await show();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Sync status: Sign in to sync' }),
    );
    expect(await screen.findByText('Sign in screen')).toBeTruthy();
  });

  it.each([
    ['offline', { online: false }, 'Saved on this device'],
    ['running', { state: { kind: 'running', batch: 0 } }, 'Syncing…'],
    ['unverified', { state: { kind: 'paused', why: 'unverified' } }, 'Confirm email to sync'],
    ['signed out', { state: { kind: 'paused', why: 'signed-out' } }, 'Sign in to sync'],
    ['error', { state: { kind: 'error', code: 'X', message: 'x', retryAt: null } }, 'Sync paused'],
  ] as const)('shows the %s state as "%s"', async (_name, patch, label) => {
    signInAs();
    useSyncStore.setState(patch as never);
    await show();
    expect(await screen.findByRole('button', { name: `Sync status: ${label}` })).toBeTruthy();
  });
});

describe('Notes tab pull to refresh', () => {
  it('syncs when signed in', async () => {
    signInAs();
    await repos.notes.save({ title: 'Kalman', bodyMd: '' });
    await show();
    await screen.findByText('Kalman');
    await pullToRefresh();
    expect(mockRunSync).toHaveBeenCalledWith('manual');
  });

  it('is not offered offline-only', async () => {
    await repos.notes.save({ title: 'Kalman', bodyMd: '' });
    await show();
    await screen.findByText('Kalman');
    await expect(pullToRefresh()).rejects.toThrow('No refreshable list');
  });
});
