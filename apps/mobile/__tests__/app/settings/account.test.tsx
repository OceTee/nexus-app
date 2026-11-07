import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Account from '../../../app/(app)/settings/account';
import { useSyncStore } from '../../../src/data/sync/store';
import { api } from '../../../src/infra/apiClient';
import { useSessionStore } from '../../../src/stores/session';
import { me, serveApi } from '../screen-helpers/api';
import { lastToast, renderScreen, resetStores, signInAs } from '../screen-helpers/setup';

jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = api as jest.Mock;
const usage = {
  notes: 12,
  collections: 3,
  tags: 5,
  versions: 40,
  attachments: 2,
  attachmentBytes: 2048,
  quotaBytes: 1_073_741_824,
};
const recently = new Date().toISOString();
const audit = {
  items: [
    { id: 'e1', action: 'auth.login', createdAt: recently, deviceName: 'Pixel 8' },
    { id: 'e2', action: 'custom.thing', createdAt: recently, deviceName: null },
  ],
};

const show = () => renderScreen({ 'settings/account': Account }, '/settings/account');

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  signInAs();
});

describe('Account', () => {
  it('shows the profile, server usage and security events', async () => {
    serveApi(mockApi, {
      'GET /v1/me': me(),
      'GET /v1/me/usage': usage,
      'GET /v1/me/audit?limit=20': audit,
    });
    await show();
    expect(screen.getByRole('header', { name: 'Account' })).toBeTruthy();
    expect(await screen.findByText(/Member since .* · email confirmed/)).toBeTruthy();
    expect(screen.getByText('amara@example.com')).toBeTruthy();
    expect(await screen.findByText('12')).toBeTruthy();
    expect(screen.getByText('2 · 2 KB of 1.0 GB')).toBeTruthy();
    expect(await screen.findByText('Signed in')).toBeTruthy();
    expect(screen.getByText('Just now · Pixel 8')).toBeTruthy();
    expect(screen.getByText('custom.thing')).toBeTruthy();
    expect(screen.getByLabelText('Display name').props.value).toBe('Amara');
  });

  it('notes an unconfirmed email and an empty audit log', async () => {
    serveApi(mockApi, {
      'GET /v1/me': me({ emailVerified: false }),
      'GET /v1/me/usage': usage,
      'GET /v1/me/audit?limit=20': { items: [] },
    });
    await show();
    expect(await screen.findByText(/email not confirmed/)).toBeTruthy();
    expect(await screen.findByText('No events yet.')).toBeTruthy();
  });

  it('falls back to the cached profile when the server is unreachable', async () => {
    mockApi.mockRejectedValue(new Error('offline'));
    useSyncStore.setState({ online: false });
    await show();
    expect(await screen.findByText('Available when online.')).toBeTruthy();
    expect(screen.getByText('amara@example.com')).toBeTruthy();
    expect(screen.getByText(/Editing your account needs a connection/)).toBeTruthy();
    expect(screen.getByLabelText('Display name').props.value).toBe('Amara');
  });

  it('saves a new display name', async () => {
    let name = 'Amara';
    serveApi(mockApi, {
      'GET /v1/me': () => me({ displayName: name }),
      'GET /v1/me/usage': usage,
      'GET /v1/me/audit?limit=20': audit,
      'PATCH /v1/me': (body) => {
        name = (body as { displayName: string }).displayName;
        return me({ displayName: name });
      },
    });
    await show();
    await screen.findByText(/Member since/);
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Display name'), '  Amara O.  ');
    await fireEvent.press(await screen.findByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(lastToast()).toBe('Name saved'));
    expect(mockApi).toHaveBeenCalledWith('/v1/me', {
      method: 'PATCH',
      body: { displayName: 'Amara O.' },
    });
    expect(useSessionStore.getState().user?.displayName).toBe('Amara O.');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull());
  });

  it('hides Save when the name is unchanged', async () => {
    serveApi(mockApi, {
      'GET /v1/me': me(),
      'GET /v1/me/usage': usage,
      'GET /v1/me/audit?limit=20': audit,
    });
    await show();
    await screen.findByText(/Member since/);
    await fireEvent.changeText(screen.getByLabelText('Display name'), 'Amara ');
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
  });

  it('says when saving fails', async () => {
    serveApi(mockApi, {
      'GET /v1/me': me(),
      'GET /v1/me/usage': usage,
      'GET /v1/me/audit?limit=20': audit,
      'PATCH /v1/me': () => {
        throw new Error('offline');
      },
    });
    await show();
    await screen.findByText(/Member since/);
    await fireEvent.changeText(screen.getByLabelText('Display name'), 'New');
    await fireEvent.press(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(lastToast()).toBe('Could not save. Check your connection.'));
  });
});
