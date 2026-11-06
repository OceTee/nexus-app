import { router, useLocalSearchParams } from 'expo-router';
import {
  Combine,
  FileText,
  MoreVertical,
  Palette,
  Pencil,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { NoteList } from '@/features/notes/NoteList';
import {
  ActionSheet,
  ConfirmSheet,
  EmptyState,
  Fab,
  Header,
  IconButton,
  Screen,
  Text,
  toast,
  useTheme,
} from '@/ui';

/** S-21 Tag detail: notes with the tag, and the tag's own actions. */
export default function TagDetail() {
  const t = useTheme();
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data } = useLocalQuery(
    ['tags', 'note_tags', 'notes'],
    async () => ({
      tag: await repos.tags.get(tagId),
      notes: await repos.notes.list({ tagId, limit: 1000 }),
    }),
    [tagId],
  );
  const tag = data?.tag;

  if (data && !tag) {
    return (
      <Screen>
        <Header />
        <EmptyState icon={TagIcon} title="This tag was deleted" />
      </Screen>
    );
  }

  const edit = (mode?: 'merge' | 'colour') =>
    router.push({ pathname: '/tag/edit', params: { id: tagId, ...(mode ? { mode } : {}) } });

  return (
    <Screen>
      <Header
        right={
          <IconButton icon={MoreVertical} label="More actions" onPress={() => setMenu(true)} />
        }
      >
        <View style={styles.title}>
          <View style={[styles.dot, { backgroundColor: tag?.colour ?? t.colors.primary }]} />
          <Text variant="headline" numberOfLines={1} accessibilityRole="header" style={styles.flex}>
            {tag?.name ?? ''}
          </Text>
          <Text variant="footnote" tone="inkFaint">
            {tag?.noteCount ?? 0} notes
          </Text>
        </View>
      </Header>
      <NoteList
        notes={data?.notes ?? []}
        empty={<EmptyState icon={FileText} title="No notes carry this tag" />}
      />
      <Fab
        label="New note with this tag"
        onPress={() => router.push({ pathname: '/note/new', params: { tagId } })}
      />
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          { label: 'Rename', icon: Pencil, onPress: () => edit() },
          { label: 'Recolour', icon: Palette, onPress: () => edit('colour') },
          { label: 'Merge into…', icon: Combine, onPress: () => edit('merge') },
          {
            label: 'Delete',
            icon: Trash2,
            destructive: true,
            onPress: () => setConfirmDelete(true),
          },
        ]}
      />
      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${tag?.name ?? ''}”?`}
        body="The tag comes off every note. The notes themselves stay."
        confirmLabel="Delete tag"
        destructive
        onConfirm={() =>
          void repos.tags.remove(tagId).then(() => {
            toast.show('Tag deleted');
            router.back();
          })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  flex: { flexShrink: 1 },
});
