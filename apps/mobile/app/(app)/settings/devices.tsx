import { LIMITS, type DeviceDto } from '@nexus/shared';
import { Bell, Smartphone, Tablet } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useDevices, useRenameDevice, useRevokeDevice } from '@/features/account/api';
import { relativeDate } from '@/features/notes/format';
import { OfflineNotice } from '@/features/sync/OfflineNotice';
import {
  ActionSheet,
  alpha,
  Button,
  ConfirmSheet,
  Header,
  Screen,
  Sheet,
  Skeleton,
  Text,
  TextField,
  toast,
  useTheme,
} from '@/ui';

/** S-31 Devices: where the account is signed in; revoke or rename. */
export default function Devices() {
  const t = useTheme();
  const devices = useDevices();
  const revoke = useRevokeDevice();
  const rename = useRenameDevice();
  const [target, setTarget] = useState<DeviceDto | null>(null);
  const [confirm, setConfirm] = useState<DeviceDto | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  return (
    <Screen>
      <Header title="Devices" />
      <OfflineNotice what="Device management" />
      {devices.isLoading ? (
        <View style={styles.pad}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={56} style={styles.gap} />
          ))}
        </View>
      ) : (
        <FlatList
          data={devices.data ?? []}
          keyExtractor={(d) => d.id}
          refreshControl={
            <RefreshControl
              refreshing={devices.isRefetching}
              onRefresh={() => void devices.refetch()}
              colors={[t.colors.primary]}
            />
          }
          ListFooterComponent={
            <Text variant="footnote" tone="inkFaint" style={styles.pad}>
              Removing a device signs it out. Its notes stay on it but stop syncing.
            </Text>
          }
          renderItem={({ item }) => {
            const Icon = item.platform === 'ios' ? Tablet : Smartphone;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name}${item.isCurrent ? ', this device' : ''}, last seen ${relativeDate(item.lastSeenAt)}`}
                onPress={() => setTarget(item)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: t.colors.surface2 },
                ]}
              >
                <Icon size={24} color={t.colors.inkSoft} />
                <View style={styles.flex}>
                  <View style={styles.titleLine}>
                    <Text variant="headline" numberOfLines={1} style={styles.shrink}>
                      {item.name}
                    </Text>
                    {item.isCurrent ? (
                      <View
                        style={[styles.badge, { backgroundColor: alpha(t.colors.primary, 0.12) }]}
                      >
                        <Text variant="caption" style={{ color: t.colors.primary }}>
                          This device
                        </Text>
                      </View>
                    ) : null}
                    {item.hasPush ? <Bell size={14} color={t.colors.inkFaint} /> : null}
                  </View>
                  <Text variant="footnote" tone="inkSoft">
                    {item.platform === 'ios' ? 'iOS' : 'Android'} · NEXUS {item.appVersion} · last
                    seen {relativeDate(item.lastSeenAt).toLowerCase()}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <ActionSheet
        visible={target !== null}
        onClose={() => setTarget(null)}
        {...(target ? { title: target.name } : {})}
        actions={
          target
            ? target.isCurrent
              ? [
                  {
                    label: 'Rename this device',
                    onPress: () => setRenaming({ id: target.id, name: target.name }),
                  },
                ]
              : [{ label: 'Remove device', destructive: true, onPress: () => setConfirm(target) }]
            : []
        }
      />
      <ConfirmSheet
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        title={`Remove “${confirm?.name ?? ''}”?`}
        body="It is signed out at once. To use it again, sign in on it."
        confirmLabel="Remove device"
        destructive
        onConfirm={() =>
          confirm &&
          revoke.mutate(confirm.id, {
            onSuccess: () => toast.show('Device removed'),
            onError: () => toast.show('Could not remove the device. Try again online.'),
          })
        }
      />
      <Sheet
        visible={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename this device"
      >
        <View style={styles.sheet}>
          <TextField
            label="Name"
            value={renaming?.name ?? ''}
            onChangeText={(name) => setRenaming((r) => (r ? { ...r, name } : r))}
            maxLength={LIMITS.deviceNameMax}
            autoFocus
          />
          <Button
            label="Save"
            loading={rename.isPending}
            disabled={!renaming?.name.trim()}
            onPress={() =>
              renaming &&
              rename.mutate(
                { id: renaming.id, name: renaming.name.trim() },
                {
                  onSuccess: () => {
                    setRenaming(null);
                    toast.show('Device renamed');
                  },
                  onError: () => toast.show('Could not rename. Check your connection.'),
                },
              )
            }
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  gap: { marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  flex: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  sheet: { paddingHorizontal: 20 },
});
