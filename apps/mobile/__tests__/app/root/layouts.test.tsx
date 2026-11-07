import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import AppLayout from '../../../app/(app)/_layout';
import RootLayout from '../../../app/_layout';
import { useSyncTriggers } from '../../../src/data/sync/triggers';
import { useAttachmentUploads } from '../../../src/features/attachments/useAttachmentUploads';
import { restoreSession } from '../../../src/features/auth/authService';
import { unlock } from '../../../src/infra/biometrics';
import { openDatabase } from '../../../src/infra/db';
import { attachPushHandlers, registerForPush } from '../../../src/infra/push';
import { useSessionStore } from '../../../src/stores/session';
import { useSettingsStore } from '../../../src/stores/settings';
import { resetStores, signInAs, stub } from '../screen-helpers/setup';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  setOptions: jest.fn(),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../src/infra/db', () => ({
  ...jest.requireActual('../../../src/infra/db'),
  openDatabase: jest.fn(),
}));
jest.mock('../../../src/features/auth/authService', () => ({ restoreSession: jest.fn() }));
jest.mock('../../../src/data/sync/triggers', () => ({
  useSyncTriggers: jest.fn(),
  onSyncNudge: jest.fn(),
}));
jest.mock('../../../src/features/attachments/useAttachmentUploads', () => ({
  useAttachmentUploads: jest.fn(),
}));
jest.mock('../../../src/infra/push', () => ({
  registerForPush: jest.fn(),
  attachPushHandlers: jest.fn(),
}));
jest.mock('../../../src/infra/biometrics', () => ({ unlock: jest.fn() }));

const mockOpen = openDatabase as jest.Mock;
const mockRestore = restoreSession as jest.Mock;
const mockAttach = attachPushHandlers as jest.Mock;
const detach = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  mockOpen.mockResolvedValue({});
  mockRestore.mockImplementation(async () => useSessionStore.setState({ status: 'local' }));
  (registerForPush as jest.Mock).mockResolvedValue(undefined);
  mockAttach.mockReturnValue(detach);
  (unlock as jest.Mock).mockResolvedValue(false);
});

describe('Root layout', () => {
  const routes = {
    _layout: RootLayout,
    index: stub('Home'),
    '(auth)/_layout': Slot,
    '(app)/_layout': Slot,
    '(auth)/sign-in': stub('Sign in'),
    '(app)/notes': stub('Notes'),
    verify: stub('Verify'),
    reset: stub('Reset'),
  };

  it('keeps the splash up until the database is open and the session restored', async () => {
    useSessionStore.setState({ status: 'loading' });
    mockRestore.mockReturnValue(new Promise(() => undefined));
    await renderRouter(routes, { initialUrl: '/' });
    await waitFor(() => expect(mockOpen).toHaveBeenCalled());
    expect(screen.queryByText('Home screen')).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
    await act(async () => useSessionStore.setState({ status: 'local' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it('opens the app routes offline-only', async () => {
    useSessionStore.setState({ status: 'loading' });
    await renderRouter(routes, { initialUrl: '/notes' });
    expect(await screen.findByText('Notes screen')).toBeTruthy();
    expect(mockRestore).toHaveBeenCalled();
  });

  it('keeps signed-in people out of the auth screens', async () => {
    mockRestore.mockImplementation(async () => signInAs());
    await renderRouter(routes, { initialUrl: '/sign-in' });
    await waitFor(() => expect(screen.queryByText('Sign in screen')).toBeNull());
  });

  it('opens email links in any state', async () => {
    mockRestore.mockImplementation(async () => useSessionStore.setState({ status: 'anon' }));
    await renderRouter(routes, { initialUrl: '/verify' });
    expect(await screen.findByText('Verify screen')).toBeTruthy();
  });

  it('explains a database that cannot open and retries', async () => {
    mockOpen.mockRejectedValueOnce(new Error('disk I/O error'));
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText('NEXUS could not open its database')).toBeTruthy();
    expect(screen.getByText('Error: disk I/O error')).toBeTruthy();
    expect(screen.queryByText('Home screen')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  // Regression (fixed): "Try again" calls openDatabase() but nothing clears dbError, so the
  // error screen stays up even when the retry succeeds. (In the app the retry
  // also returns the cached rejected promise: openDatabase() memoises
  // the `opening` promise even when it failed, so it never succeeds without a restart.)
  it('recovers when the retry opens the database', async () => {
    mockOpen.mockRejectedValueOnce(new Error('database is locked'));
    await renderRouter(routes, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
  });

  it('follows the dark theme', async () => {
    useSettingsStore.setState({ theme: 'dark' });
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText('Home screen')).toBeTruthy();
  });
});

describe('App layout', () => {
  const modals = [
    'note/[noteId]/backlinks',
    'note/[noteId]/tags',
    'note/[noteId]/conflict',
    'collection/edit',
    'collection/picker',
    'tag/edit',
    'attachment/pick',
    'graph/filters',
  ];
  const routes = {
    '(app)/_layout': AppLayout,
    '(app)/(tabs)/_layout': Slot,
    '(app)/(tabs)/notes': stub('Notes'),
    '(app)/settings/sync': stub('Sync'),
    ...Object.fromEntries(modals.map((m) => [`(app)/${m}`, stub(m)])),
  };

  it('runs sync and upload triggers and leaves push alone offline-only', async () => {
    await renderRouter(routes, { initialUrl: '/notes' });
    expect(await screen.findByText('Notes screen')).toBeTruthy();
    expect(useSyncTriggers).toHaveBeenCalled();
    expect(useAttachmentUploads).toHaveBeenCalled();
    expect(registerForPush).not.toHaveBeenCalled();
  });

  it('registers for push while signed in and detaches on unmount', async () => {
    signInAs();
    const r = await renderRouter(routes, { initialUrl: '/notes' });
    await screen.findByText('Notes screen');
    expect(registerForPush).toHaveBeenCalled();
    expect(mockAttach).toHaveBeenCalled();
    await r.unmount();
    expect(detach).toHaveBeenCalled();
  });

  it('replays a deep link kept from before sign-in', async () => {
    await renderRouter(routes, { initialUrl: '/notes' });
    await screen.findByText('Notes screen');
    await act(async () => useSessionStore.setState({ pendingLink: '/settings/sync' }));
    expect(await screen.findByText('Sync screen')).toBeTruthy();
    expect(useSessionStore.getState().pendingLink).toBeNull();
  });

  it('opens a modal route', async () => {
    const r = await renderRouter(routes, { initialUrl: '/notes' });
    await screen.findByText('Notes screen');
    await act(async () => {
      const { router } = jest.requireActual<typeof import('expo-router')>('expo-router');
      router.push('/graph/filters');
    });
    expect(await screen.findByText('graph/filters screen')).toBeTruthy();
    expect(r.getPathname()).toBe('/graph/filters');
  });

  it('covers the app with the lock screen when the lock is on', async () => {
    useSettingsStore.setState({ lockEnabled: true });
    await renderRouter(routes, { initialUrl: '/notes' });
    expect(await screen.findByText('NEXUS is locked')).toBeTruthy();
  });
});
