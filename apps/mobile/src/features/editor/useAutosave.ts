import { useCallback, useEffect, useRef, useState } from 'react';
import { repos } from '@/data/repos';

export const AUTOSAVE_MS = 500;

export type SaveState = 'saved' | 'pending' | 'saving' | 'failed';

/**
 * Debounced autosave (S-09): writes 500 ms after the last change. `flush`
 * saves immediately (back navigation, backgrounding, unmount). The save
 * rewrites links and FTS in the same transaction (NotesRepo.save).
 */
export function useAutosave(noteId: string | undefined) {
  const pending = useRef<{ title: string; bodyMd: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<SaveState>('saved');

  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const draft = pending.current;
    if (!draft || !noteId) return chain.current;
    pending.current = null;
    setState('saving');
    chain.current = chain.current
      .then(() => repos.notes.save({ id: noteId, ...draft }))
      .then(
        () => setState(pending.current ? 'pending' : 'saved'),
        () => {
          // Keep the draft so the next attempt retries it.
          pending.current ??= draft;
          setState('failed');
        },
      );
    return chain.current;
  }, [noteId]);

  const schedule = useCallback(
    (draft: { title: string; bodyMd: string }) => {
      pending.current = draft;
      setState('pending');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush],
  );

  useEffect(() => () => void flush(), [flush]);

  return { schedule, flush, state };
}
