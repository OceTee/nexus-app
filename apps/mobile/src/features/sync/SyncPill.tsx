import { router } from 'expo-router';
import { AlertCircle, Check, CloudOff, HardDrive, RefreshCw } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { repos } from '@/data/repos';
import { useSyncStore } from '@/data/sync';
import { useLocalQuery } from '@/data/useLocalQuery';
import { getDb } from '@/infra/db';
import { useSessionStore } from '@/stores/session';
import { alpha, Text, useTheme } from '@/ui';

/**
 * Sync pill (S-08 and other headers): one glance at sync state. Offline it
 * reads "Saved on this device"; errors never become modals (TDD Section C).
 */
export function SyncPill() {
  const t = useTheme();
  const status = useSessionStore((s) => s.status);
  const run = useSyncStore((s) => s.state);
  const online = useSyncStore((s) => s.online);
  const { data: pending = 0 } = useLocalQuery(['outbox'], () => repos.outbox.pendingCount(getDb()));

  let Icon = Check;
  let label = 'Synced';
  let colour = t.colors.primary;
  let target: '/settings' | '/settings/sync' = '/settings/sync';

  if (status === 'local') {
    Icon = HardDrive;
    label = 'This device';
    colour = t.colors.inkSoft;
    target = '/settings';
  } else if (online === false || run.kind === 'offline') {
    Icon = CloudOff;
    label = 'Saved on this device';
    colour = t.colors.inkSoft;
  } else if (run.kind === 'paused') {
    Icon = AlertCircle;
    label = run.why === 'unverified' ? 'Confirm email to sync' : 'Sign in to sync';
    colour = t.colors.accent;
    target = '/settings';
  } else if (run.kind === 'error') {
    Icon = AlertCircle;
    label = 'Sync paused';
    colour = t.colors.danger;
  } else if (run.kind === 'running') {
    Icon = RefreshCw;
    label = 'Syncing…';
  } else if (pending > 0) {
    Icon = RefreshCw;
    label = `${pending} to sync`;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${label}`}
      accessibilityHint="Opens sync details"
      onPress={() => router.push(target)}
      style={[styles.pill, { backgroundColor: alpha(colour, 0.12) }]}
    >
      <Icon size={14} color={colour} />
      <Text variant="caption" style={{ color: colour }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
});
