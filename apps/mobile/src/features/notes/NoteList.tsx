import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import type { Note } from '@/data/repos';
import { NoteRow } from './NoteRow';
import { deleteNote, togglePin, useNoteActions } from './useNoteActions';
import { useNoteDecor } from './useNoteDecor';

const openNote = (note: Note) =>
  router.push({ pathname: '/note/[noteId]', params: { noteId: note.id } });

/** A FlashList of NoteRows with swipe and long-press actions (S-08, S-17, S-21). */
export function NoteList({
  notes,
  header,
  empty,
}: {
  notes: Note[];
  header?: ReactElement;
  empty?: ReactElement;
}) {
  const decor = useNoteDecor();
  const actions = useNoteActions();
  return (
    <>
      <FlashList
        data={notes}
        keyExtractor={(n) => n.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) => (
          <NoteRow
            note={item}
            tags={decor.tagsByNote.get(item.id) ?? []}
            breadcrumb={decor.breadcrumb(item.collectionId)}
            conflicted={decor.conflicted.has(item.id)}
            onPress={openNote}
            onLongPress={actions.open}
            onTogglePin={(n) => void togglePin(n)}
            onDelete={(n) => void deleteNote(n)}
          />
        )}
      />
      {actions.sheet}
    </>
  );
}
