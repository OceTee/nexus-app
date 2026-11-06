import { WifiOff } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSyncStore } from '@/data/sync';
import { Text, useTheme } from '@/ui';

/** Inline explanation on network-only screens (TDD Section G, Offline behaviour). */
export function OfflineNotice({ what }: { what: string }) {
  const t = useTheme();
  const online = useSyncStore((s) => s.online);
  if (online !== false) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.box, { backgroundColor: t.colors.surface2, borderColor: t.colors.line }]}
    >
      <WifiOff size={18} color={t.colors.inkSoft} />
      <Text variant="callout" tone="inkSoft" style={styles.flex}>
        {what} needs a connection. Everything else keeps working offline.
      </Text>
    </View>
  );
}

/** Whether the device is known to be offline (null counts as online: we try). */
export function useIsOffline(): boolean {
  return useSyncStore((s) => s.online === false);
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
