import { FileText } from 'lucide-react-native';
import { FlatList } from 'react-native';
import { repos } from '../../../../src/data/repos';
import { useLocalQuery } from '../../../../src/data/useLocalQuery';
import { EmptyState, ListRow, Screen, Skeleton } from '../../../../src/ui';

/** S-08 Notes list. The editor and new-note button arrive with Phase 8. */
export default function NotesList() {
  const { data: notes, loading } = useLocalQuery(['notes'], () => repos.notes.list());

  return (
    <Screen title="Notes">
      {loading ? (
        <Skeleton height={56} style={{ marginHorizontal: 16 }} />
      ) : notes && notes.length > 0 ? (
        <FlatList
          data={notes}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => (
            <ListRow title={item.title || 'Untitled'} subtitle={item.excerpt} />
          )}
        />
      ) : (
        <EmptyState
          icon={FileText}
          title="No notes yet"
          body="Notes you write appear here, and they work offline."
        />
      )}
    </Screen>
  );
}
