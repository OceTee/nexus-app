import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Security from '../../../app/(app)/settings/security';
import { changePassword } from '../../../src/features/auth/authService';
import { ApiError } from '../../../src/infra/apiClient';
import { canUseLock, unlock } from '../../../src/infra/biometrics';
import { useSettingsStore } from '../../../src/stores/settings';
import { lastToast, renderScreen, resetStores, signInAs } from '../screen-helpers/setup';

jest.mock('../../../src/infra/biometrics', () => ({ canUseLock: jest.fn(), unlock: jest.fn() }));
jest.mock('../../../src/features/auth/authService', () => ({ changePassword: jest.fn() }));

const mockCanUseLock = canUseLock as jest.Mock;
const mockUnlock = unlock as jest.Mock;
const mockChange = changePassword as jest.Mock;

const show = () => renderScreen({ 'settings/security': Security }, '/settings/security');
const lockSwitch = () => screen.getByRole('switch', { name: 'App lock' });

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  mockCanUseLock.mockResolvedValue(true);
  mockUnlock.mockResolvedValue(true);
  mockChange.mockResolvedValue(undefined);
});

describe('Security: app lock', () => {
  it('turns the lock on after confirming with biometrics', async () => {
    await show();
    expect(await screen.findByText('Fingerprint, face or passcode')).toBeTruthy();
    await fireEvent(lockSwitch(), 'valueChange', true);
    await waitFor(() => expect(lastToast()).toBe('App lock on'));
    expect(mockUnlock).toHaveBeenCalledWith('Confirm to turn on the lock');
    expect(useSettingsStore.getState().lockEnabled).toBe(true);
    expect(await screen.findByLabelText('Lock timeout')).toBeTruthy();
  });

  it('stays off when biometrics fail', async () => {
    mockUnlock.mockResolvedValue(false);
    await show();
    await screen.findByText('Fingerprint, face or passcode');
    await fireEvent(lockSwitch(), 'valueChange', true);
    await waitFor(() => expect(mockUnlock).toHaveBeenCalled());
    expect(useSettingsStore.getState().lockEnabled).toBe(false);
    expect(lastToast()).toBeNull();
  });

  it('changes the timeout and turns the lock off without a prompt', async () => {
    useSettingsStore.setState({ lockEnabled: true });
    await show();
    await fireEvent.press(await screen.findByRole('tab', { name: '1 min' }));
    expect(useSettingsStore.getState().lockTimeoutSec).toBe(60);
    await fireEvent(lockSwitch(), 'valueChange', false);
    await waitFor(() => expect(lastToast()).toBe('App lock off'));
    expect(mockUnlock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Lock timeout')).toBeNull();
  });

  it('is unavailable without a screen lock on the phone', async () => {
    mockCanUseLock.mockResolvedValue(false);
    await show();
    expect(await screen.findByText('Set up a screen lock on this phone first')).toBeTruthy();
    expect(lockSwitch().props.disabled ?? lockSwitch().props.accessibilityState?.disabled).toBe(
      true,
    );
  });

  it('offers no password change offline-only', async () => {
    await show();
    await screen.findByText('Fingerprint, face or passcode');
    expect(screen.queryByText('CHANGE PASSWORD')).toBeNull();
  });
});

describe('Security: change password', () => {
  const fill = async (current: string, next: string, confirm: string) => {
    await fireEvent.changeText(screen.getByLabelText('Current password'), current);
    await fireEvent.changeText(screen.getByLabelText('New password'), next);
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), confirm);
  };

  beforeEach(() => signInAs());

  it('changes the password and clears the form', async () => {
    await show();
    await screen.findByRole('header', { name: 'CHANGE PASSWORD' });
    await fill('old-password', 'correct-horse-battery', 'correct-horse-battery');
    await fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() =>
      expect(lastToast()).toBe('Password changed. Other devices are signed out.'),
    );
    expect(mockChange).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'correct-horse-battery',
    });
    await waitFor(() => expect(screen.getByLabelText('Current password').props.value).toBe(''));
  });

  it('shows "Passwords differ" when the confirmation does not match', async () => {
    await show();
    await screen.findByRole('header', { name: 'CHANGE PASSWORD' });
    await fill('old-password', 'correct-horse-battery', 'something-else');
    await fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Passwords differ')).toBeTruthy();
    expect(mockChange).not.toHaveBeenCalled();
  });

  it('shows a server error under the form', async () => {
    mockChange.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'nope'));
    await show();
    await screen.findByRole('header', { name: 'CHANGE PASSWORD' });
    await fill('wrong-password', 'correct-horse-battery', 'correct-horse-battery');
    await fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
  });
});
