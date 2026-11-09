import { useEffect, useRef, useState } from 'react';
import { events, type Table } from './events';

/**
 * Runs a local (SQLite) query and re-runs it when any of `tables` is written
 * (TDD Section G: screens re-query through the change bus; no polling).
 * `deps` are primitive values the query closes over; a change re-runs it.
 */
export function useLocalQuery<T>(
  tables: Table[],
  query: () => Promise<T>,
  deps: readonly (string | number | boolean | null | undefined)[] = [],
) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });
  const tableKey = tables.join(',');
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    let alive = true;
    // Writes in quick succession start overlapping loads; only the newest may
    // set state, or an older, slower load would put stale data back.
    let latest = 0;
    const load = () => {
      const mine = ++latest;
      const current = () => alive && mine === latest;
      return queryRef.current().then(
        (v) => {
          if (!current()) return;
          setData(v);
          setError(null);
        },
        (e: unknown) => {
          if (current()) setError(e);
        },
      );
    };
    void load();
    const off = events.on(tableKey.split(',') as Table[], () => void load());
    return () => {
      alive = false;
      off();
    };
  }, [tableKey, depsKey]);

  return { data, error, loading: data === undefined && !error } as const;
}
