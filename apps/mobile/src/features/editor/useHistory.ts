import { useCallback, useRef, useState } from 'react';
import type { Edit } from './textOps';

const MAX_ENTRIES = 200;
/** Typing within this window joins one undo step. */
const COALESCE_MS = 800;

interface Stacks {
  past: Edit[];
  present: Edit;
  future: Edit[];
}

/**
 * Undo/redo for the editor (S-09 toolbar). Keystrokes close together become
 * one step; toolbar actions always start a new step.
 */
export function useHistory(initial: Edit) {
  const [stacks, setStacks] = useState<Stacks>({ past: [], present: initial, future: [] });
  const lastPush = useRef(0);

  const record = useCallback((next: Edit, discrete: boolean) => {
    const now = Date.now();
    const newStep = discrete || now - lastPush.current > COALESCE_MS;
    lastPush.current = discrete ? 0 : now;
    setStacks((s) => ({
      past: newStep ? [...s.past, s.present].slice(-MAX_ENTRIES) : s.past,
      present: next,
      future: [],
    }));
  }, []);

  /** Moves the cursor without creating an undo step. */
  const select = useCallback((selection: Edit['selection']) => {
    setStacks((s) => ({ ...s, present: { ...s.present, selection } }));
  }, []);

  /** Replaces everything without history (loading a note). */
  const reset = useCallback((edit: Edit) => {
    lastPush.current = 0;
    setStacks({ past: [], present: edit, future: [] });
  }, []);

  /** Steps back; returns the restored edit so the caller can save it. */
  const undo = useCallback((): Edit | null => {
    const prev = stacks.past.at(-1);
    if (!prev) return null;
    lastPush.current = 0;
    setStacks({
      past: stacks.past.slice(0, -1),
      present: prev,
      future: [...stacks.future, stacks.present],
    });
    return prev;
  }, [stacks]);

  const redo = useCallback((): Edit | null => {
    const next = stacks.future.at(-1);
    if (!next) return null;
    lastPush.current = 0;
    setStacks({
      past: [...stacks.past, stacks.present],
      present: next,
      future: stacks.future.slice(0, -1),
    });
    return next;
  }, [stacks]);

  return {
    present: stacks.present,
    record,
    select,
    reset,
    undo,
    redo,
    canUndo: stacks.past.length > 0,
    canRedo: stacks.future.length > 0,
  };
}
