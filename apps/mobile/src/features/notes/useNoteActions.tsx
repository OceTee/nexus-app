import { router } from 'expo-router';
import { FolderInput, Pin, PinOff, Tags, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { repos, type Note } from '@/data/repos';
import { ActionSheet, toast } from '@/ui';

/** Moves a note to Trash with an undo-free toast (Trash restores it). */
export async function deleteNote(note: Note): Promise<void> {
  await repos.notes.trashNote(note.id);
  toast.show(`“${note.title || 'Untitled'}” moved to Trash`);
}

export async function togglePin(note: Note): Promise<void> {
  await repos.notes.setPinned(note.id, !note.isPinned);
}

/**
 * Long-press context menu for a note (S-08): Pin, Move, Tags, Delete.
 * Returns an opener and the sheet element to render once per screen.
 */
export function useNoteActions() {
  const [target, setTarget] = useState<Note | null>(null);
  const open = useCallback((note: Note) => setTarget(note), []);
  const sheet = (
    <ActionSheet
      visible={target !== null}
      onClose={() => setTarget(null)}
      {...(target ? { title: target.title || 'Untitled' } : {})}
      actions={
        target
          ? [
              {
                label: target.isPinned ? 'Unpin' : 'Pin',
                icon: target.isPinned ? PinOff : Pin,
                onPress: () => void togglePin(target),
              },
              {
                label: 'Move to collection',
                icon: FolderInput,
                onPress: () =>
                  router.push({ pathname: '/collection/picker', params: { noteId: target.id } }),
              },
              {
                label: 'Tags',
                icon: Tags,
                onPress: () =>
                  router.push({ pathname: '/note/[noteId]/tags', params: { noteId: target.id } }),
              },
              {
                label: 'Delete',
                icon: Trash2,
                destructive: true,
                onPress: () => void deleteNote(target),
              },
            ]
          : []
      }
    />
  );
  return { open, sheet };
}
