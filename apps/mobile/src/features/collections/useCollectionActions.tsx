import { router } from 'expo-router';
import { FolderInput, Pencil, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { repos, type Collection } from '@/data/repos';
import { ActionSheet, ConfirmSheet, toast } from '@/ui';

/**
 * Long-press / overflow menu for a collection (S-16, S-17): Rename, Move,
 * Delete. Deleting a non-empty collection asks first and moves its notes
 * and sub-collections to the parent (BR-08).
 */
export function useCollectionActions(all: Collection[], onDeleted?: () => void) {
  const [target, setTarget] = useState<Collection | null>(null);
  const [confirm, setConfirm] = useState<Collection | null>(null);
  const open = useCallback((c: Collection) => setTarget(c), []);

  const remove = async (c: Collection) => {
    await repos.collections.remove(c.id);
    toast.show(`Deleted “${c.name}”`);
    onDeleted?.();
  };

  const sheet = (
    <>
      <ActionSheet
        visible={target !== null}
        onClose={() => setTarget(null)}
        {...(target ? { title: target.name } : {})}
        actions={
          target
            ? [
                {
                  label: 'Rename',
                  icon: Pencil,
                  onPress: () =>
                    router.push({ pathname: '/collection/edit', params: { id: target.id } }),
                },
                {
                  label: 'Move',
                  icon: FolderInput,
                  onPress: () =>
                    router.push({
                      pathname: '/collection/picker',
                      params: { collectionId: target.id },
                    }),
                },
                {
                  label: 'Delete',
                  icon: Trash2,
                  destructive: true,
                  onPress: () => {
                    const hasChildren = all.some((c) => c.parentId === target.id);
                    if (target.noteCount === 0 && !hasChildren) void remove(target);
                    else setConfirm(target);
                  },
                },
              ]
            : []
        }
      />
      <ConfirmSheet
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        title={`Delete “${confirm?.name ?? ''}”?`}
        body="Its notes and sub-collections move to the parent collection. No notes are deleted."
        confirmLabel="Move notes to parent and delete"
        destructive
        onConfirm={() => confirm && void remove(confirm)}
      />
    </>
  );
  return { open, sheet };
}
