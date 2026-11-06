import type { NoteVersionDto, Paginated } from '@nexus/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { History } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { useSyncStore } from '@/data/sync';
import { useLocalQuery } from '@/data/useLocalQuery';
import { wordDelta } from '@/features/history/diff';
import { api } from '@/infra/apiClient';
import { useSessionStore } from '@/stores/session';
import { alpha, EmptyState, Header, Screen, Text, useTheme } from '@/ui';

interface Row {
  key: string;
  versionId: string;
  source: 'local' | 'server';
  rev: number;
  createdAt: string;
  device: string;
  delta: string;
  conflict: boolean;
}

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** S-11 Version history: local versions at once, server versions when online. */
export default function Versions() {
  const t = useTheme();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const authed = useSessionStore((s) => s.status === 'authed');
  const offline = useSyncStore((s) => s.online === false);

  const { data: local = [] } = useLocalQuery(
    ['note_versions_local'],
    () => repos.versions.local(noteId),
    [noteId],
  );

  const server = useInfiniteQuery({
    queryKey: ['versions', noteId],
    enabled: authed && !offline,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Paginated<NoteVersionDto>>(
        `/v1/notes/${noteId}/versions?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : null),
  });

  const sections = useMemo(() => {
    const rows: Row[] = [];
    const serverRows = server.data?.pages.flatMap((p) => p.items) ?? [];
    const newestServer = serverRows[0]?.createdAt ?? '';
    // Once the server's history is here, local copies it already holds would
    // repeat it; keep only edits not synced yet and conflicted copies.
    const shownLocal = server.data
      ? local.filter((v) => v.conflict === 1 || v.created_at > newestServer)
      : local;
    shownLocal.forEach((v, i) => {
      const older = shownLocal.slice(i + 1).find((o) => o.conflict === 0);
      rows.push({
        key: `l-${v.id}`,
        versionId: v.id,
        source: 'local',
        rev: v.rev,
        createdAt: v.created_at,
        device: v.conflict
          ? 'This device (conflicted copy)'
          : server.data
            ? 'This device (not synced yet)'
            : 'This device',
        delta: wordDelta(older?.body_md ?? '', v.body_md),
        conflict: v.conflict === 1,
      });
    });
    serverRows.forEach((v, i) => {
      const prev = serverRows[i + 1];
      const d = prev ? v.wordCount - prev.wordCount : v.wordCount;
      rows.push({
        key: `s-${v.id}`,
        versionId: v.id,
        source: 'server',
        rev: v.rev,
        createdAt: v.createdAt,
        device: v.deviceName ?? 'Another device',
        delta: d === 0 ? '±0' : d > 0 ? `+${d}` : `−${-d}`,
        conflict: v.conflict,
      });
    });
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const byDay = new Map<string, Row[]>();
    for (const r of rows) {
      const k = dayLabel(r.createdAt);
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
    return [...byDay.entries()].map(([title, data]) => ({ title, data }));
  }, [local, server.data]);

  const footer =
    offline || !authed ? (
      <Text variant="footnote" tone="inkFaint" style={styles.footer}>
        {authed
          ? 'Older versions are available when online.'
          : 'Sign in to see versions from other devices.'}
      </Text>
    ) : server.isFetching ? (
      <Text variant="footnote" tone="inkFaint" style={styles.footer}>
        Loading older versions…
      </Text>
    ) : null;

  return (
    <Screen>
      <Header title="History" />
      {sections.length === 0 && !server.isFetching ? (
        <EmptyState icon={History} title="No versions yet" body="Versions appear as you edit." />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => r.key}
          refreshControl={
            <RefreshControl
              refreshing={server.isRefetching}
              onRefresh={() => void server.refetch()}
              colors={[t.colors.primary]}
            />
          }
          onEndReached={() => server.hasNextPage && void server.fetchNextPage()}
          renderSectionHeader={({ section }) => (
            <Text
              variant="caption"
              tone="inkSoft"
              style={[styles.section, { backgroundColor: t.colors.surface }]}
            >
              {section.title.toUpperCase()}
            </Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/note/[noteId]/versions/[versionId]',
                  params: { noteId, versionId: item.versionId, source: item.source },
                })
              }
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: t.colors.surface2 },
              ]}
            >
              <View style={styles.flex}>
                <Text variant="headline">
                  Revision {item.rev} ·{' '}
                  {new Date(item.createdAt).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <Text variant="footnote" tone="inkSoft">
                  {item.device} · {item.delta} {/^[+−]1$/.test(item.delta) ? 'word' : 'words'}
                </Text>
              </View>
              {item.conflict ? (
                <View style={[styles.badge, { backgroundColor: alpha(t.colors.accent, 0.16) }]}>
                  <Text variant="caption" style={{ color: t.colors.accent }}>
                    Conflicted copy
                  </Text>
                </View>
              ) : null}
            </Pressable>
          )}
          ListFooterComponent={footer ?? undefined}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  flex: { flex: 1, gap: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  footer: { padding: 16, textAlign: 'center' },
});
