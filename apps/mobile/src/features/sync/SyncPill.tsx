import { router } from 'expo-router';
import { CloudOff, RefreshCw, Check } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { getDb } from '@/infra/db';
import { useSessionStore } from '@/stores/session';
import { alpha, Text, useTheme } from '@/ui';

/**
 * Sync pill (S-08 header). Shows how many changes wait in the outbox; the
 * sync engine (Phase 9) adds the syncing, offline and error states.
 */
export function SyncPill() {
  const t = useTheme();
  const status = useSessionStore((s) => s.status);
  const { data: pending = 0 } = useLocalQuery(['outbox'], () => repos.outbox.pendingCount(getDb()));

  if (status === 'local') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="On this device only. Create an account to sync."
        onPress={() => router.push('/settings')}
        style={[styles.pill, { backgroundColor: t.colors.surface2 }]}
      >
        <CloudOff size={14} color={t.colors.inkSoft} />
        <Text variant="caption" tone="inkSoft">
          This device
        </Text>
      </Pressable>
    );
  }

  const Icon = pending > 0 ? RefreshCw : Check;
  const label = pending > 0 ? `${pending} to sync` : 'Synced';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push('/settings')}
      style={[styles.pill, { backgroundColor: alpha(t.colors.primary, 0.12) }]}
    >
      <Icon size={14} color={t.colors.primary} />
      <Text variant="caption" style={{ color: t.colors.primary }}>
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
