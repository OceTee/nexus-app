import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { events } from '../../../src/data/events';
import { runSync } from '../../../src/data/sync/engine';
import { useSyncStore } from '../../../src/data/sync/store';
import { onSyncNudge, useSyncTriggers } from '../../../src/data/sync/triggers';
import { useSessionStore } from '../../../src/stores/session';

// The triggers only decide *when* to sync; the engine itself is stubbed.
jest.mock('../../../src/data/sync/engine', () => ({
  runSync: jest.fn().mockResolvedValue({ kind: 'ok', batches: 0 }),
}));
jest.mock('../../../src/infra/kv', () => ({
  kv: { get: () => null, set: jest.fn(), remove: jest.fn(), setJson: jest.fn() },
}));
// Capture the NetInfo listener so tests can report connectivity changes.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));

const runMock = jest.mocked(runSync);
const reasons = () => runMock.mock.calls.map(([r]) => r);

let netListener: (s: Partial<NetInfoState>) => void;
const netOff = jest.fn();
let appListener: (s: AppStateStatus) => void;
const appRemove = jest.fn();

const user = { id: 'u1', email: 'a@b.c', displayName: 'A', emailVerified: true };

function setForeground(state: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
}

const mounted: { unmount(): unknown }[] = [];

/** Renders the hook and forgets the initial 'start' sync. */
async function mount() {
  const hook = await render();
  runMock.mockClear();
  return hook;
}

async function render() {
  const hook = await renderHook(() => useSyncTriggers());
  mounted.push(hook);
  return hook;
}

beforeEach(() => {
  jest.useFakeTimers();
  runMock.mockClear();
  netOff.mockClear();
  appRemove.mockClear();
  jest.mocked(NetInfo.addEventListener).mockImplementation((l) => {
    netListener = l as typeof netListener;
    return netOff;
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, l) => {
    appListener = l as typeof appListener;
    return { remove: appRemove } as never;
  });
  setForeground('active');
  useSessionStore.setState({ status: 'authed', user, deviceId: 'd1' });
  useSyncStore.setState({ state: { kind: 'idle' }, online: null });
});

afterEach(async () => {
  // Unmount explicitly so no hook from an earlier test reacts to later store changes.
  for (const h of mounted.splice(0)) await h.unmount();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('does nothing while signed out', async () => {
  useSessionStore.setState({ status: 'anon' });
  await render();
  expect(runMock).not.toHaveBeenCalled();
  expect(NetInfo.addEventListener).not.toHaveBeenCalled();
});

it('syncs once on start', async () => {
  await render();
  expect(reasons()).toEqual(['start']);
});

it('syncs 5 s after the last local write (debounced)', async () => {
  await mount();
  events.emit('outbox');
  jest.advanceTimersByTime(3_000);
  events.emit('outbox');
  jest.advanceTimersByTime(4_999);
  expect(runMock).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(reasons()).toEqual(['write']);
  // Writes to other tables are not sync triggers.
  events.emit('notes');
  jest.advanceTimersByTime(10_000);
  expect(reasons()).toEqual(['write']);
});

describe('connectivity', () => {
  it('marks the store offline and syncs when the connection returns', async () => {
    await mount();
    await act(() => netListener({ isConnected: false, isInternetReachable: null }));
    expect(useSyncStore.getState()).toMatchObject({ online: false, state: { kind: 'offline' } });
    expect(runMock).not.toHaveBeenCalled();

    await act(() => netListener({ isConnected: true, isInternetReachable: true }));
    expect(useSyncStore.getState().online).toBe(true);
    expect(reasons()).toEqual(['network']);
  });

  it('treats unknown reachability as worth one attempt after being offline', async () => {
    await mount();
    await act(() => netListener({ isConnected: true, isInternetReachable: false }));
    await act(() => netListener({ isConnected: true, isInternetReachable: null }));
    expect(useSyncStore.getState().online).toBeNull();
    expect(reasons()).toEqual(['network']);
  });

  it('does not sync when going from unknown to online', async () => {
    await mount();
    await act(() => netListener({ isConnected: true, isInternetReachable: true }));
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('app state', () => {
  it('syncs when the app returns to the foreground', async () => {
    await mount();
    appListener('active');
    expect(runMock).not.toHaveBeenCalled();
    appListener('background');
    appListener('active');
    expect(reasons()).toEqual(['foreground']);
  });

  it('syncs every 15 minutes, only in the foreground', async () => {
    await mount();
    jest.advanceTimersByTime(15 * 60_000);
    expect(reasons()).toEqual(['periodic']);
    appListener('background');
    jest.advanceTimersByTime(15 * 60_000);
    expect(reasons()).toEqual(['periodic']);
  });

  it('starts in the background when launched there', async () => {
    setForeground('background');
    await mount();
    jest.advanceTimersByTime(15 * 60_000);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('retries', () => {
  const fail = async (retryAt: number | null) =>
    await act(() =>
      useSyncStore.getState().set({ state: { kind: 'error', code: 'X', message: 'x', retryAt } }),
    );

  it('retries at the time the engine scheduled', async () => {
    await mount();
    await fail(Date.now() + 10_000);
    jest.advanceTimersByTime(9_999);
    expect(runMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(reasons()).toEqual(['retry']);
  });

  it('waits at least 1 s for a retry time in the past', async () => {
    await mount();
    await fail(Date.now() - 5_000);
    jest.advanceTimersByTime(999);
    expect(runMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(reasons()).toEqual(['retry']);
  });

  it('cancels a scheduled retry when the state changes', async () => {
    await mount();
    await fail(Date.now() + 10_000);
    await act(() => useSyncStore.getState().set({ state: { kind: 'idle' } }));
    await fail(null);
    jest.advanceTimersByTime(60_000);
    expect(runMock).not.toHaveBeenCalled();
  });
});

it('removes every listener and timer on unmount', async () => {
  const hook = await mount();
  events.emit('outbox');
  await act(() =>
    useSyncStore.getState().set({
      state: { kind: 'error', code: 'X', message: 'x', retryAt: Date.now() + 1_000 },
    }),
  );
  await hook.unmount();
  expect(netOff).toHaveBeenCalled();
  expect(appRemove).toHaveBeenCalled();
  events.emit('outbox');
  await act(() =>
    useSyncStore.getState().set({
      state: { kind: 'error', code: 'X', message: 'x', retryAt: Date.now() + 1_000 },
    }),
  );
  jest.advanceTimersByTime(60 * 60_000);
  expect(runMock).not.toHaveBeenCalled();
});

it('unmounts cleanly when no write or retry is pending', async () => {
  const hook = await mount();
  await hook.unmount();
  expect(netOff).toHaveBeenCalled();
});

it('syncs on a sync.nudge push', () => {
  onSyncNudge();
  expect(reasons()).toEqual(['push']);
});
