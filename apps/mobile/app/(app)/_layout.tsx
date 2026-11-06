import { Stack } from 'expo-router';
import { useSyncTriggers } from '@/data/sync';
import { useAttachmentUploads } from '@/features/attachments/useAttachmentUploads';
import { LockGate } from '@/features/auth/LockGate';
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
  return (
    <LockGate>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.surface } }}
      >
        {MODALS.map((name) => (
          <Stack.Screen key={name} name={name} options={{ presentation: 'modal' }} />
        ))}
      </Stack>
    </LockGate>
  );
}
