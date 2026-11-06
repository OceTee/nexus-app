import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { repos } from '@/data/repos';
import { Screen } from '@/ui';

/**
 * S-10 New note: creates a draft (pre-filed in a collection or tagged when
 * opened from one) and replaces itself with the editor. The editor drops the
 * draft again if it is left empty.
 */
export default function NewNote() {
  const { collectionId, tagId, title } = useLocalSearchParams<{
    collectionId?: string;
    tagId?: string;
    title?: string;
  }>();

  useEffect(() => {
    void (async () => {
      const note = await repos.notes.save({
        title: title ?? '',
        bodyMd: '',
        collectionId: collectionId ?? null,
      });
      if (tagId) await repos.tags.setMembership(note.id, tagId, true);
      router.replace({ pathname: '/note/[noteId]', params: { noteId: note.id, fresh: '1' } });
    })();
  }, [collectionId, tagId, title]);

  return <Screen>{null}</Screen>;
}
