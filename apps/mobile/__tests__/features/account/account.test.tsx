import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  cancelDeletion,
  requestDeletion,
  useAudit,
  useDevices,
  useMe,
  useRenameDevice,
  useRevokeDevice,
  useUpdateMe,
  useUsage,
} from '../../../src/features/account/api';
import { DeletionBanner } from '../../../src/features/account/DeletionBanner';
import { api } from '../../../src/infra/apiClient';
import { useSessionStore } from '../../../src/stores/session';
import { useToastStore } from '../../../src/ui/Toast';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = api as jest.MockedFunction<typeof api>;

const me = {
  id: 'u1',
  email: 'amara@example.com',
  displayName: 'Amara',
  emailVerified: true,
  deletionRequestedAt: null as string | null,
};
const devices = [
  { id: 'd1', name: 'Phone' },
  { id: 'd2', name: 'Tablet' },
];

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

const signIn = () =>
  useSessionStore.setState({
    status: 'authed',
    deviceId: 'd1',
    accessToken: 'tok',
    user: { id: 'u1', email: 'a', displayName: 'Old', emailVerified: true },
  });

beforeEach(() => {
  jest.clearAllMocks();
  // gcTime Infinity: no garbage-collection timers left running after the tests.
  qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  useSessionStore.setState({ status: 'local', user: null, deviceId: null });
});
afterEach(() => qc.clear());

describe('queries', () => {
  it('stay idle unless signed in', async () => {
    const { result } = await renderHook(() => useMe(), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it.each([
    ['useMe', useMe, '/v1/me', me, me],
    ['useUsage', useUsage, '/v1/me/usage', { notes: 1 }, { notes: 1 }],
    ['useAudit', useAudit, '/v1/me/audit?limit=20', { items: [] }, { items: [] }],
    ['useDevices', useDevices, '/v1/devices', { items: devices }, devices],
  ] as const)('%s fetches %s', async (_name, hook, path, response, data) => {
    signIn();
    mockApi.mockResolvedValue(response);
    const { result } = await renderHook(() => hook(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(data));
    expect(mockApi).toHaveBeenCalledWith(path);
  });
});

describe('mutations', () => {
  it('useUpdateMe caches the profile and refreshes the session user', async () => {
    signIn();
    const updated = { ...me, displayName: 'New' };
    mockApi.mockResolvedValue(updated);
    const { result } = await renderHook(() => useUpdateMe(), { wrapper });
    await act(() => result.current.mutateAsync({ displayName: 'New' }));
    expect(mockApi).toHaveBeenCalledWith('/v1/me', {
      method: 'PATCH',
      body: { displayName: 'New' },
    });
    expect(qc.getQueryData(['me'])).toEqual(updated);
    expect(useSessionStore.getState().user?.displayName).toBe('New');
  });

  it('useUpdateMe leaves the session alone without a device', async () => {
    mockApi.mockResolvedValue({ ...me, displayName: 'New' });
    const { result } = await renderHook(() => useUpdateMe(), { wrapper });
    await act(() => result.current.mutateAsync({ displayName: 'New' }));
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('useRevokeDevice removes the device optimistically', async () => {
    qc.setQueryData(['devices'], devices);
    let finish!: () => void;
    mockApi.mockImplementation(() => new Promise<never>((r) => (finish = r as () => void)));
    const { result } = await renderHook(() => useRevokeDevice(), { wrapper });
    await act(async () => void result.current.mutate('d2'));
    await waitFor(() => expect(qc.getQueryData(['devices'])).toEqual([devices[0]]));
    expect(mockApi).toHaveBeenCalledWith('/v1/devices/d2', { method: 'DELETE' });
    await act(async () => finish());
  });

  it('useRevokeDevice rolls back when the server refuses', async () => {
    qc.setQueryData(['devices'], devices);
    mockApi.mockRejectedValue(new Error('no'));
    const { result } = await renderHook(() => useRevokeDevice(), { wrapper });
    await act(() => result.current.mutateAsync('d2').catch(() => undefined));
    expect(qc.getQueryData(['devices'])).toEqual(devices);
  });

  it('useRenameDevice patches the name', async () => {
    mockApi.mockResolvedValue({ id: 'd1', name: 'Work phone' });
    const { result } = await renderHook(() => useRenameDevice(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'd1', name: 'Work phone' }));
    expect(mockApi).toHaveBeenCalledWith('/v1/devices/d1', {
      method: 'PATCH',
      body: { name: 'Work phone' },
    });
  });

  it('requestDeletion and cancelDeletion call the deletion endpoint', async () => {
    mockApi.mockResolvedValue(undefined);
    await requestDeletion('pw');
    await cancelDeletion();
    expect(mockApi.mock.calls).toEqual([
      ['/v1/me/deletion', { method: 'POST', body: { password: 'pw' } }],
      ['/v1/me/deletion', { method: 'DELETE' }],
    ]);
  });
});

describe('DeletionBanner', () => {
  const show = async (deletionRequestedAt: string | null) => {
    signIn();
    qc.setQueryData(['me'], { ...me, deletionRequestedAt });
    await render(<DeletionBanner />, { wrapper });
  };

  it('renders nothing without a scheduled deletion', async () => {
    await show(null);
    expect(screen.queryByText('Cancel deletion')).toBeNull();
  });

  it('shows the purge date 30 days after the request', async () => {
    const requested = '2026-11-01T12:00:00.000Z';
    await show(requested);
    const purge = new Date(Date.parse(requested) + 30 * 86_400_000).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
    });
    expect(screen.getByText(new RegExp(`deleted on ${purge}`))).toBeTruthy();
    await fireEvent.press(screen.getByText('Details'));
    expect(router.push).toHaveBeenCalledWith('/settings/delete-account');
  });

  it('cancels the deletion', async () => {
    await show('2026-11-01T12:00:00.000Z');
    mockApi.mockResolvedValue(undefined);
    await fireEvent.press(screen.getByText('Cancel deletion'));
    await waitFor(() => expect(useToastStore.getState().message).toBe('Deletion cancelled'));
    expect(mockApi).toHaveBeenCalledWith('/v1/me/deletion', { method: 'DELETE' });
  });

  it('says when cancelling fails', async () => {
    await show('2026-11-01T12:00:00.000Z');
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/v1/me/deletion') throw new Error('offline');
      return me;
    });
    await fireEvent.press(screen.getByText('Cancel deletion'));
    await waitFor(() =>
      expect(useToastStore.getState().message).toBe('Could not cancel. Check your connection.'),
    );
  });
});
