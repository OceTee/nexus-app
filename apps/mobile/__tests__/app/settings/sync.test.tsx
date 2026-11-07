import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import SyncStatus from '../../../app/(app)/settings/sync';
import { repos } from '../../../src/data/repos';
import {
  fetchSyncStatus,
  resetAndRedownload,
  retryFailed,
  runSync,
} from '../../../src/data/sync/engine';
import { useSyncStore } from '../../../src/data/sync/store';
import type { SqlDb } from '../../../src/infra/sql';
import { freshDb, lastToast, renderScreen, resetStores, signInAs } from '../screen-helpers/setup';

jest.mock('../../../src/data/sync/engine', () => ({
  ...jest.requireActual('../../../src/data/sync/engine'),
  runSync: jest.fn(),
  retryFailed: jest.fn(),
  resetAndRedownload: jest.fn(),
  fetchSyncStatus: jest.fn(),
}));

const mocked = <T extends (...a: never[]) => unknown>(f: T) => f as unknown as jest.Mock;

let db: SqlDb;
const show = () => renderScreen({ 'settings/sync': SyncStatus }, '/settings/sync');
const counter = (label: string) => screen.getByText(label).parent?.parent;

beforeEach(async () => {
  jest.clearAllMocks();
  resetStores();
  db = await freshDb();
  mocked(runSync).mockResolvedValue({ kind: 'ok', batches: 1 });
  mocked(retryFailed).mockResolvedValue(undefined);
  mocked(resetAndRedownload).mockResolvedValue(undefined);
  mocked(fetchSyncStatus).mockResolvedValue({ serverSeq: 42 });
});

describe('Sync status', () => {
  it('is up to date with nothing queued, showing cursor and server sequence', async () => {
    signInAs();
    await repos.syncState.setCursor(7);
    useSyncStore.setState({ lastSyncAt: Date.now() });
    await show();
    expect(await screen.findByText('Up to date')).toBeTruthy();
    expect(await screen.findByText('Cursor 7 · server 42')).toBeTruthy();
    expect(screen.getByText('Last sync: Just now')).toBeTruthy();
    expect(screen.queryByText('QUEUED CHANGES')).toBeNull();
  });

  it('never syncs offline-only, and does not ask the server', async () => {
    await show();
    expect(await screen.findByText('Last sync: never')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync now' }).props.accessibilityState).toMatchObject(
      { disabled: true },
    );
    expect(fetchSyncStatus).not.toHaveBeenCalled();
  });

  it.each([
    [{ state: { kind: 'running', batch: 1 } }, 'Syncing (batch 2)'],
    [{ online: false }, 'Offline: changes are saved on this device'],
    [{ state: { kind: 'offline' } }, 'Offline: changes are saved on this device'],
    [{ state: { kind: 'paused', why: 'unverified' } }, 'Paused until you confirm your email'],
    [{ state: { kind: 'paused', why: 'signed-out' } }, 'Paused: sign in to sync'],
    [
      { state: { kind: 'error', code: 'SERVER_DOWN', message: 'x', retryAt: null } },
      'Paused after an error (SERVER_DOWN)',
    ],
  ])('describes %j', async (patch, label) => {
    signInAs();
    useSyncStore.setState(patch as never);
    await show();
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it('syncs now and refreshes the server status', async () => {
    signInAs();
    await show();
    await screen.findByText('Up to date');
    await fireEvent.press(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(lastToast()).toBe('Synced'));
    expect(runSync).toHaveBeenCalledWith('manual');
    expect(fetchSyncStatus).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when a manual sync is skipped', async () => {
    signInAs();
    mocked(runSync).mockResolvedValue({ kind: 'skipped', reason: 'busy' });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(runSync).toHaveBeenCalled());
    expect(lastToast()).toBeNull();
  });

  it('lists queued and failed changes, and retries the failed ones', async () => {
    signInAs();
    const kalman = await repos.notes.save({ title: 'Kalman', bodyMd: '' });
    await repos.notes.save({ title: '', bodyMd: 'untitled body' });
    const tag = await repos.tags.save({ name: 'maths' });
    await repos.tags.setMembership(kalman.id, tag, true);
    await db.runAsync(
      `UPDATE outbox SET status = 'failed', last_error = 'HTTP 500' WHERE entity_id = ?`,
      [kalman.id],
    );
    await show();
    expect(await screen.findByText('QUEUED CHANGES')).toBeTruthy();
    expect(screen.getByText('Note edited · Kalman')).toBeTruthy();
    expect(screen.getByText('Note edited · Untitled')).toBeTruthy();
    expect(screen.getByText('Tag changed · tag')).toBeTruthy();
    expect(screen.getByText('Tag added to note · Kalman')).toBeTruthy();
    expect(screen.getByText(/· HTTP 500$/)).toBeTruthy();
    expect(counter('Failed')).toBeTruthy();
    expect(screen.getByText('Sync or clear queued changes before resetting.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reset and re-download' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByRole('button', { name: 'Retry failed' }));
    expect(retryFailed).toHaveBeenCalled();
  });

  it('labels unknown operations by their raw name', async () => {
    signInAs();
    await db.runAsync(
      `INSERT INTO outbox (op_id, entity_type, entity_id, op, payload, base_rev, created_at, status, attempts)
       VALUES ('op1', 'widget', 'w1', 'spin', '{}', 0, ?, 'pending', 0)`,
      [new Date().toISOString()],
    );
    await show();
    expect(await screen.findByText('widget.spin · widget')).toBeTruthy();
  });

  it('shows recent errors', async () => {
    signInAs();
    useSyncStore.setState({
      errors: [{ at: new Date().toISOString(), code: 'HTTP_503', message: 'Service unavailable' }],
    });
    await show();
    expect(await screen.findByText('RECENT ERRORS')).toBeTruthy();
    expect(screen.getByText('HTTP_503')).toBeTruthy();
    expect(screen.getByText('Just now · Service unavailable')).toBeTruthy();
  });

  it('resets and re-downloads after confirming', async () => {
    signInAs();
    await show();
    await screen.findByText('Up to date');
    await fireEvent.press(screen.getByRole('button', { name: 'Reset and re-download' }));
    expect(await screen.findByText('Reset and re-download?')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Reset and re-download' });
    await fireEvent.press(buttons.at(-1)!);
    await waitFor(() => expect(lastToast()).toBe('Downloaded a fresh copy'));
    expect(resetAndRedownload).toHaveBeenCalled();
  });

  it.each([
    [new Error('Sync or discard pending changes first'), 'Sync or discard pending changes first'],
    ['boom', 'Reset failed'],
  ])('reports a failed reset (%s)', async (err, message) => {
    signInAs();
    mocked(resetAndRedownload).mockRejectedValue(err);
    await show();
    await screen.findByText('Up to date');
    await fireEvent.press(screen.getByRole('button', { name: 'Reset and re-download' }));
    const buttons = await screen.findAllByRole('button', { name: 'Reset and re-download' });
    await fireEvent.press(buttons.at(-1)!);
    await waitFor(() => expect(lastToast()).toBe(message));
  });
});
