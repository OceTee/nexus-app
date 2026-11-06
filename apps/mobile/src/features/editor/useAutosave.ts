import { useCallback, useEffect, useRef, useState } from 'react';
import { repos } from '@/data/repos';

export const AUTOSAVE_MS = 500;

/** Identifies one stored copy of a note: local edits bump the rev, synced ones the timestamp. */
export const noteStamp = (n: { localRev: number; updatedAt: string }) =>
  `${n.localRev}|${n.updatedAt}`;

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
  const saving = useRef(false);
  const lastStamp = useRef<string | null>(null);

  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const draft = pending.current;
    if (!draft || !noteId) return chain.current;
    pending.current = null;
    setState('saving');
    saving.current = true;
    chain.current = chain.current
      .then(() => repos.notes.save({ id: noteId, ...draft }))
      .then(
        (note) => {
          lastStamp.current = noteStamp(note);
          saving.current = false;
          setState(pending.current ? 'pending' : 'saved');
        },
        () => {
          saving.current = false;
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

  /** True while an edit is waiting or being written (event handlers only). */
  const isBusy = useCallback(() => saving.current || pending.current !== null, []);
  /** Stamp of the copy this editor last wrote or loaded (event handlers only). */
  const knownStamp = useCallback(() => lastStamp.current, []);
  const markLoaded = useCallback((stamp: string) => {
    lastStamp.current = stamp;
  }, []);

  return { schedule, flush, state, isBusy, knownStamp, markLoaded };
}
