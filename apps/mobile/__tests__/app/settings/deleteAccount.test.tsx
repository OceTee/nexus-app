import { fireEvent, screen, testRouter, waitFor } from 'expo-router/testing-library';
import DeleteAccount from '../../../app/(app)/settings/delete-account';
import { repos } from '../../../src/data/repos';
import { useSyncStore } from '../../../src/data/sync/store';
import { api, ApiError } from '../../../src/infra/apiClient';
import { me, serveApi } from '../screen-helpers/api';
import {
  freshDb,
  lastToast,
  renderScreen,
  resetStores,
  signInAs,
  stub,
} from '../screen-helpers/setup';

jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = api as jest.Mock;
const routes = {
  'settings/privacy': stub('Privacy'),
  'settings/delete-account': DeleteAccount,
  'settings/export': stub('Export'),
};
const show = () => renderScreen(routes, '/settings/delete-account');
const deleteButton = () => screen.getByRole('button', { name: 'Delete my account' });
const disabled = () => deleteButton().props.accessibilityState.disabled as boolean;

beforeEach(async () => {
  jest.clearAllMocks();
  resetStores();
  await freshDb();
  signInAs();
});

describe('Delete account: request', () => {
  it('needs "DELETE" and the password before it can be pressed', async () => {
    serveApi(mockApi, { 'GET /v1/me': me() });
    await show();
    expect(await screen.findByText('Before you go')).toBeTruthy();
    expect(disabled()).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Type "DELETE" to confirm'), 'delete');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'pw');
    expect(disabled()).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Type "DELETE" to confirm'), 'DELETE');
    expect(disabled()).toBe(false);
  });

  it('schedules the deletion', async () => {
    let requested: string | null = null;
    serveApi(mockApi, {
      'GET /v1/me': () => me({ deletionRequestedAt: requested }),
      'POST /v1/me/deletion': () => {
        requested = '2026-11-01T12:00:00.000Z';
      },
    });
    await show();
    await screen.findByText('Before you go');
    await fireEvent.changeText(screen.getByLabelText('Type "DELETE" to confirm'), 'DELETE');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret-pass');
    await fireEvent.press(deleteButton());
    await waitFor(() =>
      expect(lastToast()).toBe('Deletion scheduled. You can cancel for 30 days.'),
    );
    expect(mockApi).toHaveBeenCalledWith('/v1/me/deletion', {
      method: 'POST',
      body: { password: 'secret-pass' },
    });
    expect(await screen.findByText('Deletion is scheduled')).toBeTruthy();
  });

  it('shows a wrong password under the field', async () => {
    serveApi(mockApi, {
      'GET /v1/me': me(),
      'POST /v1/me/deletion': () => {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'nope');
      },
    });
    await show();
    await screen.findByText('Before you go');
    await fireEvent.changeText(screen.getByLabelText('Type "DELETE" to confirm'), 'DELETE');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
    await fireEvent.press(deleteButton());
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
  });

  it('warns about unsynced changes', async () => {
    serveApi(mockApi, { 'GET /v1/me': me() });
    await repos.notes.save({ title: 'Unsynced', bodyMd: '' });
    await show();
    expect(
      await screen.findByText('Unsynced changes on this device will be lost (1 waiting).'),
    ).toBeTruthy();
  });

  it('cannot delete offline', async () => {
    serveApi(mockApi, { 'GET /v1/me': me() });
    useSyncStore.setState({ online: false });
    await show();
    expect(await screen.findByText(/Deleting your account needs a connection/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Type "DELETE" to confirm'), 'DELETE');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'pw');
    expect(disabled()).toBe(true);
  });

  it('offers to export first', async () => {
    serveApi(mockApi, { 'GET /v1/me': me() });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Export first' }));
    expect(await screen.findByText('Export screen')).toBeTruthy();
  });
});

describe('Delete account: scheduled', () => {
  const requested = '2026-11-01T12:00:00.000Z';

  it('shows the erase date and cancels', async () => {
    let at: string | null = requested;
    serveApi(mockApi, {
      'GET /v1/me': () => me({ deletionRequestedAt: at }),
      'DELETE /v1/me/deletion': () => {
        at = null;
      },
    });
    await renderScreen(routes, '/settings/privacy');
    await testRouter.push('/settings/delete-account');
    expect(await screen.findByText('Deletion is scheduled')).toBeTruthy();
    const purge = new Date(Date.parse(requested) + 30 * 86_400_000).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    expect(screen.getByText(new RegExp(`erased on ${purge}`))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel deletion' }));
    await waitFor(() => expect(lastToast()).toBe('Deletion cancelled'));
    expect(await screen.findByText('Privacy screen')).toBeTruthy();
  });

  it('says when cancelling fails', async () => {
    serveApi(mockApi, {
      'GET /v1/me': me({ deletionRequestedAt: requested }),
      'DELETE /v1/me/deletion': () => {
        throw new Error('offline');
      },
    });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel deletion' }));
    await waitFor(() => expect(lastToast()).toBe('Could not cancel. Check your connection.'));
    expect(screen.getByText('Deletion is scheduled')).toBeTruthy();
  });
});
