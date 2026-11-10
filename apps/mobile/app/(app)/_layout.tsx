import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useSyncTriggers } from '@/data/sync';
import { useAttachmentUploads } from '@/features/attachments/useAttachmentUploads';
import { LockGate } from '@/features/auth/LockGate';
import { attachPushHandlers, registerForPush } from '@/infra/push';
import { useSessionStore } from '@/stores/session';
import { useTheme } from '@/ui';

export const unstable_settings = { anchor: '(tabs)' };

/** Screens that open as modals over the current screen (TDD Section B). */
const MODALS = [
  'note/[noteId]/backlinks',
  'note/[noteId]/tags',
  'note/[noteId]/conflict',
  'collection/edit',
  'collection/picker',
  'tag/edit',
  'attachment/pick',
  'graph/filters',
] as const;

export default function AppLayout() {
  const t = useTheme();
  useSyncTriggers();
  useAttachmentUploads();
  const authed = useSessionStore((s) => s.status === 'authed');
  const pendingLink = useSessionStore((s) => s.pendingLink);

  useEffect(() => {
    if (!authed) return;
    void registerForPush();
    return attachPushHandlers();
  }, [authed]);

  // A deep link opened while signed out is replayed once the app is available.
  useEffect(() => {
    if (!pendingLink) return;
    useSessionStore.getState().setPendingLink(null);
    router.push(pendingLink as never);
  }, [pendingLink]);
  return (
    <LockGate>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.surface },
          // Native screens set the status bar themselves; follow the app's theme,
          // not the system's (dark mode had dark, unreadable status-bar icons).
          statusBarStyle: t.scheme === 'dark' ? 'light' : 'dark',
        }}
      >
        {MODALS.map((name) => (
          <Stack.Screen key={name} name={name} options={{ presentation: 'modal' }} />
        ))}
      </Stack>
    </LockGate>
  );
}
