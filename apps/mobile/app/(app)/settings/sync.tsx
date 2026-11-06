import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import type { OutboxRow } from '@/data/rows';
import {
  fetchSyncStatus,
  resetAndRedownload,
  retryFailed,
  runSync,
  useSyncStore,
} from '@/data/sync';
import { useLocalQuery } from '@/data/useLocalQuery';
import { relativeDate } from '@/features/notes/format';
import { getDb } from '@/infra/db';
import { useSessionStore } from '@/stores/session';
import { Button, Card, ConfirmSheet, Header, Screen, Text, toast, useTheme } from '@/ui';

const OP_LABEL: Record<string, string> = {
  'note.upsert': 'Note edited',
  'note.delete': 'Note deleted',
  'collection.upsert': 'Collection changed',
  'collection.delete': 'Collection deleted',
  'tag.upsert': 'Tag changed',
  'tag.delete': 'Tag deleted',
  'note_tag.add': 'Tag added to note',
  'note_tag.remove': 'Tag removed from note',
  'attachment.upsert': 'Attachment',
  'attachment.delete': 'Attachment deleted',
};

/** S-32 Sync status: make synchronisation transparent and debuggable. */
export default function SyncStatus() {
  const t = useTheme();
  const run = useSyncStore((s) => s.state);
  const online = useSyncStore((s) => s.online);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const errors = useSyncStore((s) => s.errors);
  const authed = useSessionStore((s) => s.status === 'authed');
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data } = useLocalQuery(['outbox', 'conflicts', 'notes'], async () => {
    const db = getDb();
    const [ops, conflicts, cursor, titles] = await Promise.all([
      repos.outbox.all(db),
      repos.conflicts.open(),
      repos.syncState.cursor(),
      db.getAllAsync<{ id: string; title: string }>(`SELECT id, title FROM notes`),
    ]);
    return {
      ops,
      conflicts: conflicts.length,
      cursor,
      titles: new Map(titles.map((r) => [r.id, r.title])),
    };
  });
  const server = useQuery({
    queryKey: ['sync-status'],
    queryFn: fetchSyncStatus,
    enabled: authed && online !== false,
  });

  const ops = data?.ops ?? [];
  const pending = ops.filter((o) => o.status !== 'failed');
  const failed = ops.filter((o) => o.status === 'failed');
  const stateLabel =
    run.kind === 'running'
      ? `Syncing (batch ${run.batch + 1})`
      : run.kind === 'offline' || online === false
        ? 'Offline: changes are saved on this device'
        : run.kind === 'paused'
          ? run.why === 'unverified'
            ? 'Paused until you confirm your email'
            : 'Paused: sign in to sync'
          : run.kind === 'error'
            ? `Paused after an error (${run.code})`
            : 'Up to date';

  const syncNow = async () => {
    setBusy(true);
    const r = await runSync('manual');
    setBusy(false);
    void server.refetch();
    if (r.kind === 'ok') toast.show('Synced');
  };

  const entityName = (o: OutboxRow) => {
    const id = o.entity_type === 'note_tag' ? o.entity_id.split(':')[0] : o.entity_id;
    return data?.titles.get(id ?? '') || (o.entity_type === 'note' ? 'Untitled' : o.entity_type);
  };

  return (
    <Screen>
      <Header title="Sync" />
      <ScrollView contentContainerStyle={styles.pad}>
        <Card>
          <Text variant="headline">{stateLabel}</Text>
          <Text variant="callout" tone="inkSoft" style={styles.gap}>
            Last sync: {lastSyncAt ? relativeDate(new Date(lastSyncAt).toISOString()) : 'never'}
          </Text>
          <Text variant="footnote" tone="inkFaint" style={styles.gap}>
            Cursor {data?.cursor ?? 0}
            {server.data ? ` · server ${server.data.serverSeq}` : ''}
          </Text>
        </Card>

        <View style={styles.counters}>
          {[
            ['Waiting', pending.length],
            ['Failed', failed.length],
            ['Conflicts', data?.conflicts ?? 0],
          ].map(([label, n]) => (
            <Card key={label} style={styles.counter}>
              <Text variant="title2" align="center">
                {n}
              </Text>
              <Text variant="footnote" tone="inkSoft" align="center">
                {label}
              </Text>
            </Card>
          ))}
        </View>

        <View style={styles.buttons}>
          <Button
            label="Sync now"
            loading={busy}
            disabled={!authed}
            onPress={() => void syncNow()}
          />
          {failed.length > 0 ? (
            <Button label="Retry failed" variant="secondary" onPress={() => void retryFailed()} />
          ) : null}
        </View>

        {ops.length > 0 ? (
          <>
            <Text variant="caption" tone="inkSoft" style={styles.section}>
              QUEUED CHANGES
            </Text>
            {ops.slice(0, 100).map((o) => (
              <View key={o.op_id} style={[styles.op, { borderBottomColor: t.colors.line }]}>
                <RefreshCw
                  size={16}
                  color={o.status === 'failed' ? t.colors.danger : t.colors.inkSoft}
                />
                <View style={styles.flex}>
                  <Text variant="callout" numberOfLines={1}>
                    {OP_LABEL[`${o.entity_type}.${o.op}`] ?? `${o.entity_type}.${o.op}`} ·{' '}
                    {entityName(o)}
                  </Text>
                  <Text variant="footnote" tone={o.status === 'failed' ? 'danger' : 'inkFaint'}>
                    {relativeDate(o.created_at)}
                    {o.status === 'failed' && o.last_error ? ` · ${o.last_error}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {errors.length > 0 ? (
          <>
            <Text variant="caption" tone="inkSoft" style={styles.section}>
              RECENT ERRORS
            </Text>
            {errors.map((e, i) => (
              <View key={i} style={[styles.op, { borderBottomColor: t.colors.line }]}>
                <View style={styles.flex}>
                  <Text variant="callout">{e.code}</Text>
                  <Text variant="footnote" tone="inkSoft">
                    {relativeDate(e.at)} · {e.message}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}

        <View style={styles.reset}>
          <Button
            label="Reset and re-download"
            variant="destructive"
            disabled={!authed || pending.length > 0 || failed.length > 0}
            onPress={() => setConfirmReset(true)}
          />
          {pending.length > 0 || failed.length > 0 ? (
            <Text variant="footnote" tone="inkSoft" style={styles.gap}>
              Sync or clear queued changes before resetting.
            </Text>
          ) : null}
        </View>
      </ScrollView>
      <ConfirmSheet
        visible={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset and re-download?"
        body="This device's synced copy is replaced with a fresh download from the server. Nothing on the server changes."
        confirmLabel="Reset and re-download"
        destructive
        onConfirm={() => {
          setBusy(true);
          void resetAndRedownload()
            .then(() => toast.show('Downloaded a fresh copy'))
            .catch((e: unknown) => toast.show(e instanceof Error ? e.message : 'Reset failed'))
            .finally(() => setBusy(false));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48 },
  gap: { marginTop: 4 },
  counters: { flexDirection: 'row', gap: 8, marginTop: 12 },
  counter: { flex: 1, paddingVertical: 12 },
  buttons: { gap: 8, marginTop: 16 },
  section: { marginTop: 24, marginBottom: 4 },
  op: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
  reset: { marginTop: 32 },
});
