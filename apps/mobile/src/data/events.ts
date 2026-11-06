// Change bus (TDD Section G, React Native architecture): repositories emit the
// tables they wrote; feature hooks re-query when a table they read changes.

export type Table =
  | 'notes'
  | 'collections'
  | 'tags'
  | 'note_tags'
  | 'note_links'
  | 'attachments'
  | 'outbox'
  | 'conflicts'
  | 'note_versions_local';

type Listener = (tables: ReadonlySet<Table>) => void;

const listeners = new Set<Listener>();

export const events = {
  emit(...tables: Table[]): void {
    const set = new Set(tables);
    for (const l of listeners) l(set);
  },
  /** Subscribes to writes on any of `tables`; returns an unsubscribe function. */
  on(tables: Table[], listener: () => void): () => void {
    const wrapped: Listener = (changed) => {
      if (tables.some((t) => changed.has(t))) listener();
    };
    listeners.add(wrapped);
    return () => listeners.delete(wrapped);
  },
};
