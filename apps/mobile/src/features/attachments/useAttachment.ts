import type { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { repos } from '@/data/repos';
import type { AttachmentRow } from '@/data/rows';
import { useLocalQuery } from '@/data/useLocalQuery';
import { getDb } from '@/infra/db';
import { ensureCached } from './cache';

export type AttachmentLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; row: AttachmentRow; file: File }
  | { kind: 'missing' }
  | { kind: 'offline'; row: AttachmentRow };

/** An attachment row plus its local file, downloading it into the cache if needed. */
export function useAttachment(id: string): AttachmentLoad {
  const { data: row } = useLocalQuery(
    ['attachments'],
    () => getDb().getFirstAsync<AttachmentRow>(`SELECT * FROM attachments WHERE id = ?`, [id]),
    [id],
  );
  const [state, setState] = useState<AttachmentLoad>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    if (row === undefined) return;
    const work = async (): Promise<AttachmentLoad> => {
      if (!row || row.deleted_at) return { kind: 'missing' };
      try {
        return { kind: 'ready', row, file: await ensureCached(row) };
      } catch {
        return { kind: 'offline', row };
      }
    };
    void work().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [row]);

  return state;
}

/** Attachments of a note, for the editor's strip. */
export function useNoteAttachments(noteId: string) {
  return (
    useLocalQuery(['attachments'], () => repos.attachments.forNote(noteId), [noteId]).data ?? []
  );
}
