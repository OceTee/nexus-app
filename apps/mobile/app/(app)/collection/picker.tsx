import { LIMITS } from '@nexus/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Folder, Inbox } from 'lucide-react-native';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';
import { CollectionPlacementError, repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { depthOf, descendants, flattenTree, heightOf } from '@/features/collections/tree';
import { Header, Screen, Text, toast, useTheme } from '@/ui';

/**
 * S-19 Move to collection (modal). Moves a note (`noteId`) or a collection
 * (`collectionId`); destinations that would break the depth ≤ 6 rule or put
 * a collection inside itself are disabled.
 */
export default function CollectionPicker() {
  const t = useTheme();
  const { noteId, collectionId } = useLocalSearchParams<{
    noteId?: string;
    collectionId?: string;
  }>();
  const { data } = useLocalQuery(['collections', 'notes'], async () => ({
    all: await repos.collections.list(),
    current: noteId
      ? ((await repos.notes.get(noteId))?.collectionId ?? null)
      : collectionId
        ? ((await repos.collections.get(collectionId))?.parentId ?? null)
        : null,
  }));
  const all = useMemo(() => data?.all ?? [], [data?.all]);
  // Every node is expanded in the picker.
  const rows = useMemo(() => flattenTree(all, new Set(all.map((c) => c.id))), [all]);
  const blocked = useMemo(() => {
    if (!collectionId) return new Set<string>();
    const out = descendants(all, collectionId);
    out.add(collectionId);
    const height = heightOf(all, collectionId);
    for (const c of all) {
      if (depthOf(all, c.id) + height > LIMITS.collectionDepthMax) out.add(c.id);
    }
    return out;
  }, [all, collectionId]);

  const choose = async (target: string | null) => {
    try {
      if (noteId) {
        await repos.notes.move(noteId, target);
      } else if (collectionId) {
        const c = await repos.collections.get(collectionId);
        if (c) await repos.collections.save({ id: c.id, name: c.name, parentId: target });
      }
      const name = target ? all.find((c) => c.id === target)?.name : null;
      toast.show(
        name ? `Moved to “${name}”` : noteId ? 'Moved to Unfiled' : 'Moved to the top level',
      );
      router.back();
    } catch (e) {
      toast.show(e instanceof CollectionPlacementError ? e.message : 'Could not move it');
    }
  };

  const rootLabel = noteId ? 'Unfiled' : 'Top level';

  return (
    <Screen>
      <Header title="Move to" backLabel="Cancel" />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.collection.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: data?.current === null }}
            onPress={() => void choose(null)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.surface2 }]}
          >
            <Inbox size={20} color={t.colors.inkSoft} />
            <Text variant="body" style={styles.flex}>
              {rootLabel}
            </Text>
            {data?.current === null ? <Check size={20} color={t.colors.primary} /> : null}
          </Pressable>
        }
        renderItem={({ item }) => {
          const c = item.collection;
          const disabled = blocked.has(c.id);
          const selected = data?.current === c.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}
              accessibilityLabel={`${c.name}${disabled ? ', not available' : ''}`}
              disabled={disabled}
              onPress={() => void choose(c.id)}
              style={({ pressed }) => [
                styles.row,
                { paddingLeft: 16 + item.depth * 16 },
                pressed && { backgroundColor: t.colors.surface2 },
                disabled && styles.disabled,
              ]}
            >
              <Folder size={20} color={t.colors.primary} />
              <Text variant="body" numberOfLines={1} style={styles.flex}>
                {c.name}
              </Text>
              {selected ? <Check size={20} color={t.colors.primary} /> : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  flex: { flex: 1 },
  disabled: { opacity: 0.4 },
});
