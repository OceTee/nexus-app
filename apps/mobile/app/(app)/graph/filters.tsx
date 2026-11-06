import { Check } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { activeFilterCount, useGraphStore } from '@/features/graph/store';
import { collectionPath } from '@/features/notes/useNoteDecor';
import { Button, Chip, Header, Screen, Text, useTheme } from '@/ui';

/** S-24 Graph filters (sheet): tags, collection, orphans and shared-tag edges. */
export default function GraphFilters() {
  const t = useTheme();
  const filters = useGraphStore((s) => s.filters);
  const setFilters = useGraphStore((s) => s.setFilters);
  const reset = useGraphStore((s) => s.resetFilters);
  const { data } = useLocalQuery(['tags', 'collections'], async () => ({
    tags: await repos.tags.list(),
    collections: await repos.collections.list(),
  }));
  const map = new Map((data?.collections ?? []).map((c) => [c.id, c]));

  const toggleTag = (id: string) =>
    setFilters({
      tagIds: filters.tagIds.includes(id)
        ? filters.tagIds.filter((x) => x !== id)
        : [...filters.tagIds, id],
    });

  return (
    <Screen>
      <Header
        title="Graph filters"
        backLabel="Done"
        right={
          activeFilterCount(filters) > 0 ? (
            <Button label="Reset" variant="text" onPress={reset} block={false} />
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.pad}>
        <Text variant="caption" tone="inkSoft" style={styles.section}>
          SHOW
        </Text>
        <View style={styles.switchRow}>
          <Text variant="body" style={styles.flex}>
            Notes without links
          </Text>
          <Switch
            accessibilityLabel="Show notes without links"
            value={filters.showOrphans}
            onValueChange={(showOrphans) => setFilters({ showOrphans })}
            trackColor={{ true: t.colors.primary, false: t.colors.line }}
          />
        </View>
        <View style={styles.switchRow}>
          <Text variant="body" style={styles.flex}>
            Connect notes that share a tag
          </Text>
          <Switch
            accessibilityLabel="Connect notes that share a tag"
            value={filters.tagEdges}
            onValueChange={(tagEdges) => setFilters({ tagEdges })}
            trackColor={{ true: t.colors.primary, false: t.colors.line }}
          />
        </View>

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          TAGS (ANY OF)
        </Text>
        <View style={styles.chips}>
          {(data?.tags ?? []).map((tag) => (
            <Chip
              key={tag.id}
              label={tag.name}
              colour={tag.colour}
              selected={filters.tagIds.includes(tag.id)}
              onPress={() => toggleTag(tag.id)}
            />
          ))}
          {data && data.tags.length === 0 ? (
            <Text variant="callout" tone="inkFaint">
              No tags yet.
            </Text>
          ) : null}
        </View>

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          COLLECTION
        </Text>
        {[{ id: null as string | null, label: 'All collections' }]
          .concat(
            (data?.collections ?? []).map((c) => ({
              id: c.id as string | null,
              label: collectionPath(map, c.id)
                .map((p) => p.name)
                .join(' › '),
            })),
          )
          .map((row) => {
            const on = filters.collectionId === row.id;
            return (
              <Pressable
                key={row.id ?? 'all'}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setFilters({ collectionId: row.id })}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: t.colors.surface2 },
                ]}
              >
                <Text variant="body" style={styles.flex} numberOfLines={1}>
                  {row.label}
                </Text>
                {on ? <Check size={20} color={t.colors.primary} /> : null}
              </Pressable>
            );
          })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48 },
  section: { marginTop: 16, marginBottom: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  flex: { flex: 1 },
});
