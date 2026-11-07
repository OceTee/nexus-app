// Shared helpers for the note / collection / tag / attachment / graph route tests.
// jest.mock calls stay in each test file (they are hoisted per file).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { setDbForTests } from '../../../src/infra/db';
import type { SqlDb } from '../../../src/infra/sql';
import { createTestDb } from '../../../src/test/nodeSqlite';
import { useToastStore } from '../../../src/ui/Toast';

// Screens load through async SQLite queries; allow for a busy machine running suites in parallel.
configure({ asyncUtilTimeout: 5000 });

/** A fresh migrated in-memory database installed as the app's db. */
export async function freshDb(): Promise<SqlDb> {
  const db = await createTestDb();
  setDbForTests(db);
  useToastStore.setState({ message: null });
  return db;
}

/** The message of the toast currently shown, if any. */
export const toastMessage = () => useToastStore.getState().message;

/** react-query provider with retries off, for screens that call the API. */
export function queryWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** The nearest host ScrollView around an element (lists have no label of their own). */
export function scrollViewOf<T extends { type: unknown; parent: T | null }>(el: T): T {
  let node: T | null = el;
  while (node && node.type !== 'RCTScrollView') node = node.parent;
  if (!node) throw new Error('No ScrollView around the element');
  return node;
}
