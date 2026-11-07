// Push notifications (src/infra/push.ts): registration rules, sign-out,
// foreground and tap handling, and the Android background task for nudges.

import { useSessionStore } from '../../src/stores/session';
import {
  attachPushHandlers,
  BACKGROUND_TASK,
  registerForPush,
  unregisterPush,
} from '../../src/infra/push';

const mockApi = jest.fn();
const mockNudge = jest.fn();
const mockPush = jest.fn();
const mockToast = jest.fn();
const mockInvalidate = jest.fn();

// Each factory keeps its own state (jest.mock runs before this file's
// variables exist); tests reach it through jest.requireMock.
jest.mock('expo-notifications', () => {
  const state = {
    listeners: {} as Record<string, (arg: unknown) => void>,
    handler: undefined as
      undefined | { handleNotification: (n: unknown) => Promise<Record<string, boolean>> },
  };
  const listen = (name: string) => (f: (arg: unknown) => void) => {
    state.listeners[name] = f;
    return { remove: jest.fn() };
  };
  return {
    __state: state,
    AndroidImportance: { LOW: 2, DEFAULT: 3 },
    setNotificationHandler: (h: typeof state.handler) => {
      state.handler = h;
    },
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getExpoPushTokenAsync: jest.fn(),
    registerTaskAsync: jest.fn().mockResolvedValue(undefined),
    addNotificationReceivedListener: listen('received'),
    addNotificationResponseReceivedListener: listen('tapped'),
    addPushTokenListener: listen('token'),
  };
});
// A getter, because `import * as Device` copies plain properties at load time.
jest.mock('expo-device', () => {
  const state = { isDevice: true };
  return {
    __state: state,
    get isDevice() {
      return state.isDevice;
    },
  };
});
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: undefined, easConfig: undefined },
}));
jest.mock('expo-task-manager', () => {
  const tasks: Record<string, (arg: { data: unknown }) => Promise<void>> = {};
  return {
    __tasks: tasks,
    defineTask: (name: string, f: (arg: { data: unknown }) => Promise<void>) => {
      tasks[name] = f;
    },
  };
});
jest.mock('expo-router', () => ({ router: { push: (p: string) => mockPush(p) } }));
jest.mock('../../src/infra/apiClient', () => ({ api: (...a: unknown[]) => mockApi(...a) }));
jest.mock('@/data/sync', () => ({ onSyncNudge: () => mockNudge() }));
jest.mock('@/ui', () => ({ toast: { show: (m: string) => mockToast(m) } }));
jest.mock('@/data/queries/client', () => ({
  queryClient: { invalidateQueries: (q: unknown) => mockInvalidate(q) },
  qk: { devices: () => ['devices'] },
}));

type NotificationsMock = {
  __state: {
    listeners: Record<string, (arg: unknown) => void>;
    handler: { handleNotification: (n: unknown) => Promise<Record<string, boolean>> };
  };
  [fn: string]: jest.Mock | unknown;
};
const notifications = jest.requireMock('expo-notifications') as NotificationsMock & {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getExpoPushTokenAsync: jest.Mock;
  registerTaskAsync: jest.Mock;
};
const listeners = notifications.__state.listeners;
const device = (jest.requireMock('expo-device') as { __state: { isDevice: boolean } }).__state;
const constants = (jest.requireMock('expo-constants') as { default: Record<string, unknown> })
  .default;
const tasks = (
  jest.requireMock('expo-task-manager') as {
    __tasks: Record<string, (arg: { data: unknown }) => Promise<void>>;
  }
).__tasks;
const handler = () => notifications.__state.handler;

const signedIn = () =>
  useSessionStore.setState({ status: 'authed', deviceId: 'dev-1', accessToken: 't' });
const note = (type: string) => ({ request: { content: { data: { type } } } });

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.mockResolvedValue({});
  notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
  notifications.requestPermissionsAsync.mockResolvedValue({ granted: true });
  device.isDevice = true;
  constants.expoConfig = { extra: { eas: { projectId: 'proj-1' } } };
  constants.easConfig = undefined;
  signedIn();
});

describe('registerForPush', () => {
  it('sends the Expo token for this device and registers the background task', async () => {
    await registerForPush();
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(mockApi).toHaveBeenCalledWith('/v1/devices/dev-1', {
      method: 'PATCH',
      body: { pushToken: 'ExponentPushToken[abc]' },
    });
    expect(notifications.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_TASK);
  });

  it('asks for permission when not yet granted, and stops if refused', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false });
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: false });
    await registerForPush();
    expect(notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('uses the EAS project id from easConfig when the config has none', async () => {
    constants.expoConfig = { extra: {} };
    constants.easConfig = { projectId: 'proj-2' };
    await registerForPush();
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-2' });
  });

  it.each([
    ['signed out', () => useSessionStore.setState({ status: 'local', deviceId: 'dev-1' })],
    ['on a simulator', () => (device.isDevice = false)],
    ['without an EAS project id', () => (constants.expoConfig = undefined)],
  ])('does nothing %s', async (_name, arrange) => {
    arrange();
    await registerForPush();
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('swallows failures: push is best effort', async () => {
    notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no network'));
    await expect(registerForPush()).resolves.toBeUndefined();
  });
});

describe('unregisterPush', () => {
  it('clears the token on the server and ignores failures', async () => {
    mockApi.mockRejectedValueOnce(new Error('offline'));
    await unregisterPush();
    expect(mockApi).toHaveBeenCalledWith('/v1/devices/dev-1', {
      method: 'PATCH',
      body: { pushToken: null },
    });
  });

  it('does nothing without a device id', async () => {
    useSessionStore.setState({ deviceId: null });
    await unregisterPush();
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('handlers', () => {
  it('keep sync nudges silent and show everything else', async () => {
    expect(await handler().handleNotification(note('sync.nudge'))).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: false,
    });
    expect(await handler().handleNotification(note('security.new-device'))).toMatchObject({
      shouldShowBanner: true,
    });
  });

  it('sync on a foreground nudge and refresh devices on a new sign-in', () => {
    const cleanup = attachPushHandlers();
    listeners.received!(note('sync.nudge'));
    expect(mockNudge).toHaveBeenCalledTimes(1);
    listeners.received!(note('security.new-device'));
    expect(mockToast).toHaveBeenCalledWith('A new device signed in to your account');
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['devices'] });
    listeners.received!({ request: { content: { data: null } } });
    cleanup();
  });

  it.each([
    ['security.new-device', '/settings/devices'],
    ['account.deletion-reminder', '/settings/delete-account'],
    ['export.ready', '/settings/export'],
  ])('open the right screen when a %s notification is tapped', (type, path) => {
    attachPushHandlers();
    listeners.tapped!({ notification: note(type) });
    expect(mockPush).toHaveBeenCalledWith(path);
  });

  it('ignore taps on notifications without a known type', () => {
    attachPushHandlers();
    listeners.tapped!({ notification: note('sync.nudge') });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('register again when Expo rotates the token', async () => {
    attachPushHandlers();
    listeners.token!(undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalled();
  });
});

describe('background task', () => {
  it('syncs on a data-only nudge, wrapped or not', async () => {
    await tasks[BACKGROUND_TASK]!({ data: { notification: { data: { type: 'sync.nudge' } } } });
    await tasks[BACKGROUND_TASK]!({ data: { type: 'sync.nudge' } });
    await tasks[BACKGROUND_TASK]!({ data: { type: 'export.ready' } });
    expect(mockNudge).toHaveBeenCalledTimes(2);
  });
});
