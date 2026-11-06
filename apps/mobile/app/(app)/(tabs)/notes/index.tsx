import { router } from 'expo-router';
import { FileText } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { NoteList } from '@/features/notes/NoteList';
import { SyncPill } from '@/features/sync/SyncPill';
import { EmptyState, Fab, Screen, SegmentedControl, Skeleton, Text } from '@/ui';

type Segment = 'all' | 'pinned' | 'recent';

const SEGMENTS = [
  { value: 'all', label: 'All' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'recent', label: 'Recent' },
] as const;

const newNote = () => router.push('/note/new');

/** S-08 Notes list: the default landing screen. */
export default function NotesList() {
  const [segment, setSegment] = useState<Segment>('all');
  const { data: notes, loading } = useLocalQuery(
    ['notes'],
    () =>
      segment === 'pinned'
        ? repos.notes.list({ pinned: true })
        : segment === 'recent'
          ? repos.notes.list({ order: 'recent', limit: 50 })
          : repos.notes.list({ limit: 1000 }),
    [segment],
  );

  const empty =
    segment === 'all' ? (
      <EmptyState
        icon={FileText}
        title="No notes yet"
        body="Notes you write appear here, and they work offline."
        action={{ label: 'Write your first note', onPress: newNote }}
      />
    ) : (
      <EmptyState
        icon={FileText}
        title={segment === 'pinned' ? 'No pinned notes' : 'Nothing edited recently'}
        {...(segment === 'pinned' ? { body: 'Swipe right on a note to pin it.' } : {})}
      />
    );

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title1" accessibilityRole="header" style={styles.title}>
          Notes
        </Text>
        <SyncPill />
      </View>
      <View style={styles.segments}>
        <SegmentedControl label="Show" options={SEGMENTS} value={segment} onChange={setSegment} />
      </View>
      {loading ? (
        <View style={styles.skeletons}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} />
          ))}
        </View>
      ) : (
        <NoteList notes={notes ?? []} empty={empty} />
      )}
      <Fab label="New note" onPress={newNote} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: { flex: 1 },
  segments: { paddingHorizontal: 16, paddingBottom: 8 },
  skeletons: { paddingHorizontal: 16, gap: 12, paddingTop: 8 },
});
