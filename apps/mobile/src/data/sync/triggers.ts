// When sync runs (TDD Section D, Triggers and scheduling): app foreground,
// connectivity regained, 5 s after the last local write, a sync.nudge push,
// pull-to-refresh and every 15 minutes in the foreground; failures retry on
// the backoff schedule.

import NetInfo from '@react-native-community/netinfo';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSessionStore } from '@/stores/session';
import { events } from '../events';
import { runSync } from './engine';
import { useSyncStore } from './store';

const WRITE_DEBOUNCE_MS = 5_000;
const PERIODIC_MS = 15 * 60_000;

/** Starts the triggers while signed in; mount once inside the signed-in app. */
export function useSyncTriggers(): void {
  const authed = useSessionStore((s) => s.status === 'authed');
  const verified = useSessionStore((s) => s.user?.emailVerified ?? false);

  useEffect(() => {
    if (!authed) return;
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let foreground = AppState.currentState === 'active';

    void runSync('start');

    const offWrites = events.on(['outbox'], () => {
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = setTimeout(() => void runSync('write'), WRITE_DEBOUNCE_MS);
    });

    const offNet = NetInfo.addEventListener((s) => {
      // null means unknown: the engine attempts once (TDD Section G, Offline behaviour).
      const online = s.isConnected === false ? false : s.isInternetReachable;
      const was = useSyncStore.getState().online;
      useSyncStore.getState().set({ online });
      if (online !== false && was === false) void runSync('network');
      if (online === false) useSyncStore.getState().set({ state: { kind: 'offline' } });
    });

    const appSub = AppState.addEventListener('change', (state) => {
      const nowForeground = state === 'active';
      if (nowForeground && !foreground) void runSync('foreground');
      foreground = nowForeground;
    });

    const periodic = setInterval(() => {
      if (foreground) void runSync('periodic');
    }, PERIODIC_MS);

    const offRetry = useSyncStore.subscribe((s) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (s.state.kind === 'error' && s.state.retryAt) {
        retryTimer = setTimeout(
          () => void runSync('retry'),
          Math.max(1_000, s.state.retryAt - Date.now()),
        );
      }
    });

    return () => {
      offWrites();
      offNet();
      appSub.remove();
      clearInterval(periodic);
      offRetry();
      if (writeTimer) clearTimeout(writeTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [authed, verified]);
}

/** Entry point for a `sync.nudge` push (registered in Phase 11). */
export function onSyncNudge(): void {
  void runSync('push');
}
