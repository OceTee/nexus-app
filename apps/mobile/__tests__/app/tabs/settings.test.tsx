import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import SettingsTab from '../../../app/(app)/(tabs)/settings/index';
import { signOut } from '../../../src/features/auth/authService';
import { api } from '../../../src/infra/apiClient';
import { APP_VERSION } from '../../../src/infra/config';
import { unregisterPush } from '../../../src/infra/push';
import { lastToast, renderScreen, resetStores, signInAs, stub } from '../screen-helpers/setup';

jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));
jest.mock('../../../src/infra/push', () => ({
  unregisterPush: jest.fn(),
}));
jest.mock('../../../src/features/auth/authService', () => ({
  signOut: jest.fn(),
}));

const mockApi = api as jest.MockedFunction<typeof api>;

const targets = [
  'settings/account',
  'settings/sync',
  'settings/security',
  'settings/devices',
  'settings/trash',
  'settings/export',
  'settings/appearance',
  'settings/privacy',
  'settings/about',
  'tags',
  'verify',
  'sign-in',
];
const routes = {
  settings: SettingsTab,
  ...Object.fromEntries(targets.map((t) => [t, stub(t)])),
};
const show = () => renderScreen(routes, '/settings');

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  mockApi.mockResolvedValue({ deletionRequestedAt: null });
  (unregisterPush as jest.Mock).mockResolvedValue(undefined);
  (signOut as jest.Mock).mockResolvedValue(undefined);
});

describe('Settings tab, offline-only', () => {
  it('offers to sign in and hides account-only rows', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Security, App lock' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Devices/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getAllByText(`NEXUS ${APP_VERSION}`).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: /^Sign in to sync/ }));
    expect(await screen.findByText('sign-in screen')).toBeTruthy();
  });

  it.each([
    [/^Security/, 'settings/security'],
    [/^Tags/, 'tags'],
    [/^Trash/, 'settings/trash'],
    [/^Export/, 'settings/export'],
    [/^Appearance/, 'settings/appearance'],
    [/^Privacy and data/, 'settings/privacy'],
    [/^About/, 'settings/about'],
  ])('row %s opens %s', async (name, target) => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name }));
    expect(await screen.findByText(`${target} screen`)).toBeTruthy();
  });

  it('does not ask the server for the profile', async () => {
    await show();
    await screen.findByRole('header', { name: 'Settings' });
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('Settings tab, signed in', () => {
  it('shows the profile and account rows', async () => {
    signInAs();
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Amara, amara@example.com' }));
    expect(await screen.findByText('settings/account screen')).toBeTruthy();
  });

  it.each([
    [/^Sync/, 'settings/sync'],
    [/^Devices/, 'settings/devices'],
  ])('row %s opens %s', async (name, target) => {
    signInAs();
    await show();
    await fireEvent.press(await screen.findByRole('button', { name }));
    expect(await screen.findByText(`${target} screen`)).toBeTruthy();
  });

  it('names the account by email without a display name, and asks to confirm the email', async () => {
    signInAs({ displayName: '', emailVerified: false });
    await show();
    expect(
      await screen.findByRole('button', {
        name: 'amara@example.com, Profile and security events',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Security, Password and app lock' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Confirm your email/ }));
    expect(await screen.findByText('verify screen')).toBeTruthy();
  });

  it('hides the confirm-email row once confirmed', async () => {
    signInAs();
    await show();
    await screen.findByRole('button', { name: /^Amara/ });
    expect(screen.queryByRole('button', { name: /^Confirm your email/ })).toBeNull();
  });

  it('signs out, clearing the push token first', async () => {
    signInAs();
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(lastToast()).toBe('Signed out. Your notes stay on this device.'));
    expect(unregisterPush).toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });
});
