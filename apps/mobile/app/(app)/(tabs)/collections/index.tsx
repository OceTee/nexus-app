import { router } from 'expo-router';
import { ChevronDown, ChevronRight, Folder, FolderPlus, Inbox } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { flattenTree } from '@/features/collections/tree';
import { useCollectionActions } from '@/features/collections/useCollectionActions';
import { EmptyState, Fab, IconButton, Screen, Text, useTheme } from '@/ui';

const newCollection = () => router.push('/collection/edit');

/** S-16 Collections: the hierarchy as an indented tree. */
export default function Collections() {
  const t = useTheme();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data } = useLocalQuery(['collections', 'notes'], async () => ({
    all: await repos.collections.list(),
    unfiled: (await repos.notes.list({ unfiled: true, limit: 100_000 })).length,
  }));
  const all = useMemo(() => data?.all ?? [], [data?.all]);
  const rows = useMemo(() => flattenTree(all, expanded), [all, expanded]);
  const actions = useCollectionActions(all);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title1" accessibilityRole="header" style={styles.flex}>
          Collections
        </Text>
        <IconButton icon={FolderPlus} label="New collection" onPress={newCollection} />
      </View>
      {data && all.length === 0 && data.unfiled === 0 ? (
        <EmptyState
          icon={Folder}
          title="No collections yet"
          body="Collections keep related notes together."
          action={{ label: 'Create a collection', onPress: newCollection }}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.collection.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Unfiled, ${data?.unfiled ?? 0} notes`}
              onPress={() =>
                router.push({
                  pathname: '/collection/[collectionId]',
                  params: { collectionId: 'unfiled' },
                })
              }
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: t.colors.surface2 },
              ]}
            >
              <View style={styles.chevron} />
              <Inbox size={20} color={t.colors.inkSoft} />
              <Text variant="body" style={styles.flex}>
                Unfiled
              </Text>
              <Text variant="footnote" tone="inkFaint">
                {data?.unfiled ?? 0}
              </Text>
            </Pressable>
          }
          renderItem={({ item }) => {
            const c = item.collection;
            const open = expanded.has(c.id);
            const Chevron = open ? ChevronDown : ChevronRight;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${c.noteCount} notes, level ${item.depth + 1}`}
                accessibilityHint="Opens the collection. Long press for more actions."
                {...(item.hasChildren ? { accessibilityState: { expanded: open } } : {})}
                onPress={() =>
                  router.push({
                    pathname: '/collection/[collectionId]',
                    params: { collectionId: c.id },
                  })
                }
                onLongPress={() => actions.open(c)}
                style={({ pressed }) => [
                  styles.row,
                  { paddingLeft: 8 + item.depth * 16 },
                  pressed && { backgroundColor: t.colors.surface2 },
                ]}
              >
                {item.hasChildren ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={open ? `Collapse ${c.name}` : `Expand ${c.name}`}
                    onPress={() => toggle(c.id)}
                    hitSlop={8}
                    style={styles.chevron}
                  >
                    <Chevron size={18} color={t.colors.inkSoft} />
                  </Pressable>
                ) : (
                  <View style={styles.chevron} />
                )}
                <Folder size={20} color={t.colors.primary} />
                <Text variant="body" numberOfLines={1} style={styles.flex}>
                  {c.name}
                </Text>
                <Text variant="footnote" tone="inkFaint">
                  {c.noteCount}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
      <Fab label="New collection" icon={FolderPlus} onPress={newCollection} />
      {actions.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  flex: { flex: 1 },
  list: { paddingBottom: 96 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 8,
    paddingRight: 16,
  },
  chevron: { width: 28, alignItems: 'center' },
});
