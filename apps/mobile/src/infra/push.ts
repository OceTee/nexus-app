// Push notifications (TDD Section G, Push notifications): registration after
// sign-in, Android channels, foreground and tap handlers, and a background
// task so data-only sync nudges trigger a sync on Android.

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { router } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { queryClient, qk } from '@/data/queries/client';
import { onSyncNudge } from '@/data/sync';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/ui';
import { api } from './apiClient';

export const BACKGROUND_TASK = 'nexus-push-background';

type PushType = 'sync.nudge' | 'security.new-device' | 'export.ready' | 'account.deletion-reminder';

const typeOf = (data: unknown): PushType | null => {
  const t = (data as { type?: unknown } | null)?.type;
  return typeof t === 'string' ? (t as PushType) : null;
};

// Data-only nudges arrive here while the app is in the background (Android).
TaskManager.defineTask(BACKGROUND_TASK, async ({ data }) => {
  const payload =
    (data as { notification?: { data?: unknown } } | undefined)?.notification?.data ?? data;
  if (typeOf(payload) === 'sync.nudge') onSyncNudge();
});

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const silent = typeOf(n.request.content.data) === 'sync.nudge';
    return {
      shouldShowBanner: !silent,
      shouldShowList: !silent,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('sync', {
    name: 'Sync',
    importance: AndroidImportance.LOW,
    sound: null,
  });
  await Notifications.setNotificationChannelAsync('security', {
    name: 'Security',
    importance: AndroidImportance.DEFAULT,
  });
}

/**
 * Asks for permission and sends this device's Expo push token to the API.
 * Quietly does nothing on simulators, without permission, or when the build
 * has no EAS project id (push needs one).
 */
export async function registerForPush(): Promise<void> {
  const { deviceId, status } = useSessionStore.getState();
  if (status !== 'authed' || !deviceId || !Device.isDevice) return;
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return;
  try {
    await ensureChannels();
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api(`/v1/devices/${deviceId}`, { method: 'PATCH', body: { pushToken: token } });
    await Notifications.registerTaskAsync(BACKGROUND_TASK).catch(() => undefined);
  } catch {
    // Push is best effort; the app works fully without it.
  }
}

/** Clears the token on sign-out so this device stops receiving the account's pushes. */
export async function unregisterPush(): Promise<void> {
  const { deviceId } = useSessionStore.getState();
  if (!deviceId) return;
  await api(`/v1/devices/${deviceId}`, { method: 'PATCH', body: { pushToken: null } }).catch(
    () => undefined,
  );
}

function routeFor(type: PushType | null): void {
  if (type === 'security.new-device') router.push('/settings/devices');
  else if (type === 'account.deletion-reminder') router.push('/settings/delete-account');
  else if (type === 'export.ready') router.push('/settings/export');
}

/** Foreground and tap handlers; returns a cleanup function. */
export function attachPushHandlers(): () => void {
  const received = Notifications.addNotificationReceivedListener((n) => {
    const type = typeOf(n.request.content.data);
    if (type === 'sync.nudge') onSyncNudge();
    if (type === 'security.new-device') {
      toast.show('A new device signed in to your account');
      void queryClient.invalidateQueries({ queryKey: qk.devices() });
    }
  });
  const tapped = Notifications.addNotificationResponseReceivedListener((r) =>
    routeFor(typeOf(r.notification.request.content.data)),
  );
  const tokenSub = Notifications.addPushTokenListener(() => void registerForPush());
  return () => {
    received.remove();
    tapped.remove();
    tokenSub.remove();
  };
}
