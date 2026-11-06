import { getDb } from '@/infra/db';
import { repos, type Collection, type Tag } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';

export interface NoteDecor {
  tagsByNote: Map<string, Tag[]>;
  collections: Map<string, Collection>;
  conflicted: Set<string>;
  /** "Work › Projects" for a collection id. */
  breadcrumb: (collectionId: string | null) => string;
}

/**
 * Everything a NoteRow shows besides the note itself: tag chips, the
 * collection breadcrumb and the conflict dot. One query set for the whole list.
 */
export function useNoteDecor(): NoteDecor {
  const { data } = useLocalQuery(['tags', 'note_tags', 'collections', 'conflicts'], async () => {
    const [tags, collections, links, conflicts] = await Promise.all([
      repos.tags.list(),
      repos.collections.list(),
      getDb().getAllAsync<{ note_id: string; tag_id: string }>(
        `SELECT note_id, tag_id FROM note_tags WHERE deleted_at IS NULL ORDER BY created_at`,
      ),
      repos.conflicts.open(),
    ]);
    const tagById = new Map(tags.map((t) => [t.id, t]));
    const tagsByNote = new Map<string, Tag[]>();
    for (const l of links) {
      const tag = tagById.get(l.tag_id);
      if (!tag) continue;
      const list = tagsByNote.get(l.note_id) ?? [];
      list.push(tag);
      tagsByNote.set(l.note_id, list);
    }
    return {
      tagsByNote,
      collections: new Map(collections.map((c) => [c.id, c])),
      conflicted: new Set(conflicts.map((c) => c.note_id)),
    };
  });

  const collections = data?.collections ?? new Map<string, Collection>();
  return {
    tagsByNote: data?.tagsByNote ?? new Map(),
    collections,
    conflicted: data?.conflicted ?? new Set(),
    breadcrumb: (id) =>
      collectionPath(collections, id)
        .map((c) => c.name)
        .join(' › '),
  };
}

/** Root-first ancestry of a collection, including itself. */
export function collectionPath(all: Map<string, Collection>, id: string | null): Collection[] {
  const path: Collection[] = [];
  let cur = id ? all.get(id) : undefined;
  while (cur && path.length < 16) {
    path.unshift(cur);
    cur = cur.parentId ? all.get(cur.parentId) : undefined;
  }
  return path;
}
