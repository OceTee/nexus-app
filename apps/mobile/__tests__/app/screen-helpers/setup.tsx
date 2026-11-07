// Shared setup for screen tests: a real in-memory SQLite database, fresh
// stores and a query client, and stub routes that show where a tap navigated.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  renderRouter,
  screen,
  type MockContextConfig,
  type RenderRouterOptions,
} from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { setDbForTests } from '../../../src/infra/db';
import type { SqlDb } from '../../../src/infra/sql';
import { useSyncStore } from '../../../src/data/sync/store';
import { DEFAULT_SETTINGS, useSettingsStore } from '../../../src/stores/settings';
import { useSessionStore, type SessionUser } from '../../../src/stores/session';
import { createTestDb } from '../../../src/test/nodeSqlite';
import { useToastStore } from '../../../src/ui/Toast';

export const user: SessionUser = {
  id: 'u1',
  email: 'amara@example.com',
  displayName: 'Amara',
  emailVerified: true,
};

/** A fresh migrated database swapped in for the app's handle. */
export async function freshDb(): Promise<SqlDb> {
  const db = await createTestDb();
  setDbForTests(db);
  return db;
}

/** Resets session, sync, settings and toast stores between tests. */
export function resetStores(): void {
  useSessionStore.setState({
    status: 'local',
    user: null,
    deviceId: null,
    accessToken: null,
    pendingLink: null,
    sessionExpired: false,
  });
  useSyncStore.setState({ state: { kind: 'idle' }, online: null, lastSyncAt: null, errors: [] });
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
  useToastStore.setState({ message: null });
}

export function signInAs(over: Partial<SessionUser> = {}): void {
  useSessionStore.setState({
    status: 'authed',
    user: { ...user, ...over },
    deviceId: 'd1',
    accessToken: 'tok',
  });
}

/** The last toast message shown. */
export const lastToast = () => useToastStore.getState().message;

/** A query client without retries or GC timers, so tests end cleanly. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
}

/** A route that only shows its name, to assert navigation. */
export const stub = (name: string) =>
  function Stub() {
    return <Text>{`${name} screen`}</Text>;
  };

/** Renders routes inside a QueryClientProvider. */
export function renderScreen(
  routes: MockContextConfig,
  initialUrl: string,
  qc: QueryClient = testQueryClient(),
  options: RenderRouterOptions = {},
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderRouter(routes, { initialUrl, wrapper, ...options });
}

/** Pulls to refresh the first scroll view that supports it. */
export async function pullToRefresh(): Promise<void> {
  type Refreshable = { onRefresh?: () => void; refreshControl?: { props: Refreshable } };
  const handler = (p: Refreshable) => p.onRefresh ?? p.refreshControl?.props.onRefresh;
  const [list] =
    screen.root?.queryAll((n) => typeof handler(n.props as Refreshable) === 'function') ?? [];
  if (!list) throw new Error('No refreshable list on screen');
  await act(async () => handler(list.props as Refreshable)?.());
}
