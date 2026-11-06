import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AlertTriangle } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { qk } from '@/data/queries/client';
import { alpha, Text, toast, useTheme } from '@/ui';
import { cancelDeletion, useMe } from './api';

const DAY = 86_400_000;

/** Shown while account deletion is scheduled, with a one-tap cancel (S-36). */
export function DeletionBanner() {
  const t = useTheme();
  const qc = useQueryClient();
  const { data: me } = useMe();
  if (!me?.deletionRequestedAt) return null;
  const purge = new Date(Date.parse(me.deletionRequestedAt) + 30 * DAY);
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.box,
        { backgroundColor: alpha(t.colors.danger, 0.12), borderColor: t.colors.danger },
      ]}
    >
      <AlertTriangle size={20} color={t.colors.danger} />
      <View style={styles.flex}>
        <Text variant="callout">
          Your account will be deleted on{' '}
          {purge.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void cancelDeletion()
                .then(() => qc.invalidateQueries({ queryKey: qk.me() }))
                .then(() => toast.show('Deletion cancelled'))
                .catch(() => toast.show('Could not cancel. Check your connection.'))
            }
          >
            <Text variant="headline" style={{ color: t.colors.primary }}>
              Cancel deletion
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings/delete-account')}
          >
            <Text variant="headline" tone="inkSoft">
              Details
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  flex: { flex: 1, gap: 8 },
  actions: { flexDirection: 'row', gap: 20 },
});
