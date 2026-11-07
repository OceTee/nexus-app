import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import Privacy from '../../../app/(app)/settings/privacy';
import { repos } from '../../../src/data/repos';
import { cacheUsage, evict } from '../../../src/features/attachments/cache';
import { api } from '../../../src/infra/apiClient';
import { useSettingsStore } from '../../../src/stores/settings';
import { me, serveApi } from '../screen-helpers/api';
import {
  freshDb,
  lastToast,
  renderScreen,
  resetStores,
  signInAs,
  stub,
} from '../screen-helpers/setup';

// The attachment cache lives on the file system; its accounting is covered by
// __tests__/features/attachments/cache.test.ts.
jest.mock('../../../src/features/attachments/cache', () => ({
  cacheUsage: jest.fn(),
  evict: jest.fn(),
}));
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = api as jest.Mock;
const mockUsage = cacheUsage as jest.Mock;
const mockEvict = evict as jest.Mock;

const routes = {
  'settings/privacy': Privacy,
  'settings/export': stub('Export'),
  'settings/delete-account': stub('Delete account'),
};
const show = () => renderScreen(routes, '/settings/privacy');
const row = (label: string) => screen.getByText(label).parent!;

beforeEach(async () => {
  jest.clearAllMocks();
  resetStores();
  await freshDb();
  mockUsage.mockResolvedValue({ cached: 2048, pinned: 0 });
  mockEvict.mockResolvedValue(2048);
});

describe('Privacy and data', () => {
  it('counts what is stored on this device', async () => {
    await repos.notes.save({ title: 'A', bodyMd: '' });
    const b = await repos.notes.save({ title: 'B', bodyMd: '' });
    await repos.notes.trashNote(b.id);
    await repos.collections.save({ name: 'Work' });
    await show();
    expect(await screen.findByText('2 KB')).toBeTruthy();
    expect(screen.getByText('0 B')).toBeTruthy();
    expect(within(row('Notes')).getByText('1')).toBeTruthy();
    expect(within(row('In Trash')).getByText('1')).toBeTruthy();
    expect(within(row('Collections')).getByText('1')).toBeTruthy();
    expect(within(row('Tags')).getByText('0')).toBeTruthy();
    expect(within(row('Attachment cache')).getByText('2 KB')).toBeTruthy();
    expect(within(row('Kept offline')).getByText('0 B')).toBeTruthy();
  });

  it('clears the attachment cache after confirming', async () => {
    await show();
    const clear = await screen.findByRole('button', { name: 'Clear attachment cache' });
    await waitFor(() => expect(clear.props.accessibilityState).toMatchObject({ disabled: false }));
    await fireEvent.press(clear);
    expect(await screen.findByText('Clear the attachment cache?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear cache' }));
    await waitFor(() => expect(lastToast()).toBe('Freed 2 KB'));
    expect(mockEvict).toHaveBeenCalledWith(0);
  });

  it('cannot clear an empty cache', async () => {
    mockUsage.mockResolvedValue({ cached: 0, pinned: 0 });
    await show();
    await screen.findAllByText('0 B');
    expect(
      screen.getByRole('button', { name: 'Clear attachment cache' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it('stores the crash-report choice locally offline-only', async () => {
    await show();
    await fireEvent(
      await screen.findByRole('switch', { name: 'Share anonymous crash reports' }),
      'valueChange',
      true,
    );
    expect(useSettingsStore.getState().telemetry).toBe(true);
    expect(mockApi).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Delete account/ })).toBeNull();
  });

  it('opens Export', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Export your data' }));
    expect(await screen.findByText('Export screen')).toBeTruthy();
  });

  describe('signed in', () => {
    beforeEach(() => signInAs());

    it('reads and saves the crash-report choice on the account', async () => {
      serveApi(mockApi, {
        'GET /v1/me': me({ settings: { telemetryOptIn: true, push: { newDeviceSignIn: true } } }),
        'PATCH /v1/me': (body) => me({ settings: (body as { settings: object }).settings }),
      });
      await show();
      const toggle = await screen.findByRole('switch', { name: 'Share anonymous crash reports' });
      await waitFor(() =>
        expect(
          screen.getByRole('switch', { name: 'Share anonymous crash reports' }).props.value,
        ).toBe(true),
      );
      await fireEvent(toggle, 'valueChange', false);
      await waitFor(() =>
        expect(mockApi).toHaveBeenCalledWith('/v1/me', {
          method: 'PATCH',
          body: { settings: { telemetryOptIn: false } },
        }),
      );
      expect(useSettingsStore.getState().telemetry).toBe(false);
    });

    it('opens account deletion', async () => {
      serveApi(mockApi, { 'GET /v1/me': me() });
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: /^Delete account/ }));
      expect(await screen.findByText('Delete account screen')).toBeTruthy();
    });
  });
});
