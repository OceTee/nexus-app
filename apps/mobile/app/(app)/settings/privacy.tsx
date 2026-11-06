import { router } from 'expo-router';
import { Download, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useLocalQuery } from '@/data/useLocalQuery';
import { useMe, useUpdateMe } from '@/features/account/api';
import { cacheUsage, evict } from '@/features/attachments/cache';
import { getDb } from '@/infra/db';
import { formatBytes } from '@/features/notes/format';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { Button, Card, ConfirmSheet, Header, ListRow, Screen, Text, toast, useTheme } from '@/ui';

/** S-35 Privacy and data: what is stored where, and the telemetry choice. */
export default function Privacy() {
  const t = useTheme();
  const authed = useSessionStore((s) => s.status === 'authed');
  const telemetry = useSettingsStore((s) => s.telemetry);
  const update = useSettingsStore((s) => s.update);
  const me = useMe();
  const updateMe = useUpdateMe();
  const [confirmClear, setConfirmClear] = useState(false);

  const { data } = useLocalQuery(
    ['notes', 'collections', 'tags', 'attachments', 'note_versions_local'],
    async () => {
      const db = getDb();
      const count = async (sql: string) =>
        Number((await db.getFirstAsync<{ n: number }>(sql))?.n ?? 0);
      return {
        notes: await count(`SELECT count(*) AS n FROM notes WHERE deleted_at IS NULL`),
        trash: await count(`SELECT count(*) AS n FROM notes WHERE deleted_at IS NOT NULL`),
        collections: await count(`SELECT count(*) AS n FROM collections WHERE deleted_at IS NULL`),
        tags: await count(`SELECT count(*) AS n FROM tags WHERE deleted_at IS NULL`),
        versions: await count(`SELECT count(*) AS n FROM note_versions_local`),
        cache: await cacheUsage(),
      };
    },
  );

  const setTelemetry = (on: boolean) => {
    update({ telemetry: on });
    if (authed) updateMe.mutate({ settings: { telemetryOptIn: on } });
  };

  return (
    <Screen>
      <Header title="Privacy and data" />
      <ScrollView contentContainerStyle={styles.pad}>
        <Text variant="callout" tone="inkSoft">
          Your notes are stored on this device. With an account they are also kept on the NEXUS
          server so your devices can sync; nobody else can read them. Notes are never used for
          advertising or training.
        </Text>

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          ON THIS DEVICE
        </Text>
        <Card>
          {[
            ['Notes', data?.notes],
            ['In Trash', data?.trash],
            ['Collections', data?.collections],
            ['Tags', data?.tags],
            ['Recent versions', data?.versions],
            ['Attachment cache', data ? formatBytes(data.cache.cached) : '…'],
            ['Kept offline', data ? formatBytes(data.cache.pinned) : '…'],
          ].map(([k, v]) => (
            <View key={String(k)} style={styles.kv}>
              <Text variant="callout" tone="inkSoft">
                {k}
              </Text>
              <Text variant="callout">{v ?? '…'}</Text>
            </View>
          ))}
        </Card>
        <Button
          label="Clear attachment cache"
          variant="secondary"
          disabled={!data || data.cache.cached === 0}
          onPress={() => setConfirmClear(true)}
        />

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          DIAGNOSTICS
        </Text>
        <View style={[styles.row, { borderBottomColor: t.colors.line }]}>
          <View style={styles.flex}>
            <Text variant="body">Share anonymous crash reports</Text>
            <Text variant="footnote" tone="inkSoft">
              Error details and app version only, never note content. Off by default.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Share anonymous crash reports"
            value={me.data?.settings.telemetryOptIn ?? telemetry}
            onValueChange={setTelemetry}
            trackColor={{ true: t.colors.primary, false: t.colors.line }}
          />
        </View>

        <View style={styles.bleed}>
          <ListRow
            icon={Download}
            title="Export your data"
            onPress={() => router.push('/settings/export')}
          />
          {authed ? (
            <ListRow
              icon={Trash2}
              title="Delete account"
              subtitle="30-day grace period, then everything on the server is erased"
              onPress={() => router.push('/settings/delete-account')}
              divider={false}
            />
          ) : null}
        </View>
      </ScrollView>
      <ConfirmSheet
        visible={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear the attachment cache?"
        body="Downloaded attachments are removed from this device and download again when you open them. Kept-offline files and unsent uploads stay."
        confirmLabel="Clear cache"
        onConfirm={() => void evict(0).then((n) => toast.show(`Freed ${formatBytes(n)}`))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48, gap: 12 },
  section: { marginTop: 12 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1, gap: 2 },
  bleed: { marginHorizontal: -16, marginTop: 12 },
});
