import { router } from 'expo-router';
import { Plus, Tag as TagIcon } from 'lucide-react-native';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { EmptyState, Header, IconButton, Screen, Text, useTheme } from '@/ui';

const newTag = () => router.push('/tag/edit');

/** S-20 Tags: every tag with its note count. */
export default function Tags() {
  const t = useTheme();
  const { data: tags } = useLocalQuery(['tags', 'note_tags', 'notes'], () => repos.tags.list());
  return (
    <Screen>
      <Header title="Tags" right={<IconButton icon={Plus} label="New tag" onPress={newTag} />} />
      {tags && tags.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No tags yet"
          body="Tags group notes across collections. Add them from a note's menu."
          action={{ label: 'Create a tag', onPress: newTag }}
        />
      ) : (
        <FlatList
          data={tags ?? []}
          keyExtractor={(tag) => tag.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.noteCount} notes`}
              onPress={() => router.push({ pathname: '/tag/[tagId]', params: { tagId: item.id } })}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: t.colors.surface2 },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: item.colour ?? t.colors.primary }]} />
              <Text variant="body" numberOfLines={1} style={styles.flex}>
                {item.name}
              </Text>
              <Text variant="footnote" tone="inkFaint">
                {item.noteCount}
              </Text>
            </Pressable>
          )}
        />
      )}
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
  dot: { width: 12, height: 12, borderRadius: 6 },
  flex: { flex: 1 },
});
