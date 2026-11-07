import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Devices from '../../../app/(app)/settings/devices';
import { api } from '../../../src/infra/apiClient';
import { serveApi } from '../screen-helpers/api';
import {
  lastToast,
  pullToRefresh,
  renderScreen,
  resetStores,
  signInAs,
} from '../screen-helpers/setup';

jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
}));

const mockApi = api as jest.Mock;
const now = new Date().toISOString();
const phone = {
  id: 'd1',
  name: 'Pixel 8',
  platform: 'android',
  appVersion: '1.0.0',
  isCurrent: true,
  hasPush: true,
  lastSeenAt: now,
};
const tablet = {
  id: 'd2',
  name: 'iPad',
  platform: 'ios',
  appVersion: '1.0.0',
  isCurrent: false,
  hasPush: false,
  lastSeenAt: now,
};

const show = () => renderScreen({ 'settings/devices': Devices }, '/settings/devices');

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  signInAs();
});

describe('Devices', () => {
  it('lists devices, marking this one', async () => {
    serveApi(mockApi, { 'GET /v1/devices': { items: [phone, tablet] } });
    await show();
    expect(
      await screen.findByRole('button', { name: 'Pixel 8, this device, last seen Just now' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'iPad, last seen Just now' })).toBeTruthy();
    expect(screen.getByText('This device')).toBeTruthy();
    expect(screen.getByText('Android · NEXUS 1.0.0 · last seen just now')).toBeTruthy();
    expect(screen.getByText('iOS · NEXUS 1.0.0 · last seen just now')).toBeTruthy();
  });

  it('refreshes the list on pull', async () => {
    serveApi(mockApi, { 'GET /v1/devices': { items: [phone] } });
    await show();
    await screen.findByText('Pixel 8');
    await pullToRefresh();
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(2));
  });

  it('removes another device after confirming', async () => {
    let items = [phone, tablet];
    serveApi(mockApi, {
      'GET /v1/devices': () => ({ items }),
      'DELETE /v1/devices/d2': () => {
        items = [phone];
      },
    });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^iPad/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Remove device' }));
    expect(await screen.findByText('Remove “iPad”?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove device' }));
    await waitFor(() => expect(lastToast()).toBe('Device removed'));
    expect(mockApi).toHaveBeenCalledWith('/v1/devices/d2', { method: 'DELETE' });
    await waitFor(() => expect(screen.queryByText('iPad')).toBeNull());
  });

  it('says when removing fails', async () => {
    serveApi(mockApi, {
      'GET /v1/devices': { items: [phone, tablet] },
      'DELETE /v1/devices/d2': () => {
        throw new Error('offline');
      },
    });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^iPad/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Remove device' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove device' }));
    await waitFor(() => expect(lastToast()).toBe('Could not remove the device. Try again online.'));
  });

  it('cancels removing a device', async () => {
    serveApi(mockApi, { 'GET /v1/devices': { items: [phone, tablet] } });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^iPad/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Remove device' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    expect(mockApi).not.toHaveBeenCalledWith('/v1/devices/d2', { method: 'DELETE' });
  });

  it('renames this device', async () => {
    serveApi(mockApi, {
      'GET /v1/devices': { items: [phone] },
      'PATCH /v1/devices/d1': (body) => ({ ...phone, ...(body as object) }),
    });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Pixel 8/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Rename this device' }));
    const field = await screen.findByLabelText('Name');
    expect(field.props.value).toBe('Pixel 8');
    await fireEvent.changeText(field, '   ');
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.changeText(field, ' Work phone ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastToast()).toBe('Device renamed'));
    expect(mockApi).toHaveBeenCalledWith('/v1/devices/d1', {
      method: 'PATCH',
      body: { name: 'Work phone' },
    });
  });

  it('says when renaming fails', async () => {
    serveApi(mockApi, {
      'GET /v1/devices': { items: [phone] },
      'PATCH /v1/devices/d1': () => {
        throw new Error('offline');
      },
    });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Pixel 8/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Rename this device' }));
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Work phone');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastToast()).toBe('Could not rename. Check your connection.'));
  });
});
