import { LIMITS } from '@nexus/shared';
import { RotateCcw, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { purgeNotes, repos, type Note } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { getDb } from '@/infra/db';
import { relativeDate } from '@/features/notes/format';
import {
  ActionSheet,
  ConfirmSheet,
  EmptyState,
  Header,
  IconButton,
  ListRow,
  Screen,
  Text,
  toast,
} from '@/ui';

const DAY = 86_400_000;

/** S-37 Trash: restore or permanently delete notes; kept for 30 days. */
export default function Trash() {
  const { data: notes } = useLocalQuery(['notes'], () => repos.notes.trash());
  const [target, setTarget] = useState<Note | null>(null);
  const [confirm, setConfirm] = useState<'one' | 'all' | null>(null);
  const [now] = useState(() => Date.now());

  const daysLeft = (n: Note) =>
    Math.max(
      0,
      LIMITS.trashRetentionDays - Math.floor((now - Date.parse(n.deletedAt ?? '')) / DAY),
    );

  const restore = async (n: Note) => {
    await repos.notes.restore(n.id);
    toast.show(`Restored “${n.title || 'Untitled'}”`);
  };

  return (
    <Screen>
      <Header
        title="Trash"
        {...(notes && notes.length > 0
          ? {
              right: (
                <IconButton icon={Trash2} label="Empty trash" onPress={() => setConfirm('all')} />
              ),
            }
          : {})}
      />
      {notes && notes.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Trash is empty"
          body="Deleted notes stay here for 30 days."
        />
      ) : (
        <FlatList
          data={notes ?? []}
          keyExtractor={(n) => n.id}
          ListHeaderComponent={
            <View style={styles.note}>
              <Text variant="footnote" tone="inkSoft">
                Notes are deleted for good {LIMITS.trashRetentionDays} days after you delete them.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.title || 'Untitled'}
              subtitle={`Deleted ${relativeDate(item.deletedAt ?? item.updatedAt).toLowerCase()} · ${daysLeft(item)} days left`}
              onPress={() => setTarget(item)}
              right={
                <IconButton
                  icon={RotateCcw}
                  label={`Restore ${item.title || 'Untitled'}`}
                  onPress={() => void restore(item)}
                />
              }
            />
          )}
        />
      )}
      <ActionSheet
        visible={target !== null && confirm === null}
        onClose={() => setTarget(null)}
        {...(target ? { title: target.title || 'Untitled' } : {})}
        actions={
          target
            ? [
                { label: 'Restore', icon: RotateCcw, onPress: () => void restore(target) },
                {
                  label: 'Delete permanently',
                  icon: Trash2,
                  destructive: true,
                  onPress: () => setConfirm('one'),
                },
              ]
            : []
        }
      />
      <ConfirmSheet
        visible={confirm !== null}
        onClose={() => {
          setConfirm(null);
          setTarget(null);
        }}
        title={confirm === 'all' ? 'Empty the trash?' : 'Delete this note permanently?'}
        body="This cannot be undone."
        confirmLabel={confirm === 'all' ? 'Empty trash' : 'Delete permanently'}
        destructive
        onConfirm={() => {
          const ids =
            confirm === 'all' ? (notes ?? []).map((n) => n.id) : target ? [target.id] : [];
          void purgeNotes(getDb(), ids).then(() =>
            toast.show(ids.length === 1 ? 'Note deleted' : `${ids.length} notes deleted`),
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ note: { paddingHorizontal: 16, paddingVertical: 8 } });
