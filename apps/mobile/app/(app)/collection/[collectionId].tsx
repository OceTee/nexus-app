import { router, useLocalSearchParams } from 'expo-router';
import { FileText, Folder, MoreVertical } from 'lucide-react-native';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { childrenByParent } from '@/features/collections/tree';
import { useCollectionActions } from '@/features/collections/useCollectionActions';
import { NoteList } from '@/features/notes/NoteList';
import { collectionPath } from '@/features/notes/useNoteDecor';
import { Chip, EmptyState, Fab, Header, IconButton, Screen, Text } from '@/ui';

/** S-17 Collection detail: sub-collections as chips, then its notes. "unfiled" lists notes outside any collection. */
export default function CollectionDetail() {
  const { collectionId } = useLocalSearchParams<{ collectionId: string }>();
  const unfiled = collectionId === 'unfiled';
  const { data } = useLocalQuery(
    ['collections', 'notes'],
    async () => ({
      all: await repos.collections.list(),
      notes: await repos.notes.list(
        unfiled ? { unfiled: true, limit: 1000 } : { collectionId, limit: 1000 },
      ),
    }),
    [collectionId],
  );
  const all = useMemo(() => data?.all ?? [], [data?.all]);
  const self = all.find((c) => c.id === collectionId);
  const children = childrenByParent(all).get(unfiled ? '__none__' : collectionId) ?? [];
  const path = collectionPath(new Map(all.map((c) => [c.id, c])), unfiled ? null : collectionId);
  const actions = useCollectionActions(all, () => router.back());

  if (data && !unfiled && !self) {
    return (
      <Screen>
        <Header />
        <EmptyState icon={Folder} title="This collection was deleted" />
      </Screen>
    );
  }

  const header = (
    <View style={styles.top}>
      {path.length > 1 ? (
        <Text variant="footnote" tone="inkFaint" numberOfLines={1}>
          {path
            .slice(0, -1)
            .map((c) => c.name)
            .join(' › ')}
        </Text>
      ) : null}
      {children.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {children.map((c) => (
            <Chip
              key={c.id}
              label={`${c.name} · ${c.noteCount}`}
              onPress={() =>
                router.push({
                  pathname: '/collection/[collectionId]',
                  params: { collectionId: c.id },
                })
              }
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <Header
        title={unfiled ? 'Unfiled' : (self?.name ?? '')}
        {...(self
          ? {
              right: (
                <IconButton
                  icon={MoreVertical}
                  label="More actions"
                  onPress={() => actions.open(self)}
                />
              ),
            }
          : {})}
      />
      <NoteList
        notes={data?.notes ?? []}
        header={header}
        empty={<EmptyState icon={FileText} title="No notes in this collection" />}
      />
      <Fab
        label="New note here"
        onPress={() =>
          router.push(unfiled ? '/note/new' : { pathname: '/note/new', params: { collectionId } })
        }
      />
      {actions.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 8 },
  chips: { gap: 8, paddingVertical: 4 },
});
