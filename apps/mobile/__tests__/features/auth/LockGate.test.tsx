import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, BackHandler, Text } from 'react-native';
import { LockGate } from '../../../src/features/auth/LockGate';
import { unlock } from '../../../src/infra/biometrics';
import { useSettingsStore } from '../../../src/stores/settings';

jest.mock('../../../src/infra/biometrics', () => ({ unlock: jest.fn() }));

const mockUnlock = unlock as jest.MockedFunction<typeof unlock>;
let appStateListener: (s: string) => void;
let now = 0;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListener = fn as (s: string) => void;
    return { remove: jest.fn() };
  });
  useSettingsStore.setState({ lockEnabled: true, lockTimeoutSec: 30 });
});
afterEach(() => jest.restoreAllMocks());

const app = () =>
  render(
    <LockGate>
      <Text>Notes</Text>
    </LockGate>,
  );

describe('LockGate', () => {
  it('shows the app without a lock when disabled', async () => {
    useSettingsStore.setState({ lockEnabled: false });
    await app();
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.queryByText('NEXUS is locked')).toBeNull();
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('locks at launch and unlocks after biometrics', async () => {
    mockUnlock.mockResolvedValue(true);
    await app();
    await waitFor(() => expect(screen.queryByText('NEXUS is locked')).toBeNull());
    expect(mockUnlock).toHaveBeenCalledWith('Unlock NEXUS');
  });

  it('stays locked after a failed attempt and retries from the button', async () => {
    mockUnlock.mockResolvedValueOnce(false);
    await app();
    expect(await screen.findByText('Not recognised. Try again or use your passcode.')).toBeTruthy();

    mockUnlock.mockResolvedValueOnce(false);
    await fireEvent.press(screen.getByText('Unlock'));
    expect(screen.getByText('NEXUS is locked')).toBeTruthy();

    mockUnlock.mockResolvedValueOnce(true);
    await fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(screen.queryByText('NEXUS is locked')).toBeNull());
  });

  it('relocks after the app was in the background longer than the timeout', async () => {
    mockUnlock.mockResolvedValue(true);
    await app();
    await waitFor(() => expect(screen.queryByText('NEXUS is locked')).toBeNull());

    // A short trip away keeps it unlocked.
    now = 0;
    await act(async () => appStateListener('background'));
    now = 10_000;
    await act(async () => appStateListener('active'));
    expect(mockUnlock).toHaveBeenCalledTimes(1);

    mockUnlock.mockResolvedValue(false);
    now = 20_000;
    await act(async () => appStateListener('background'));
    now = 60_000;
    await act(async () => appStateListener('active'));
    expect(await screen.findByText('NEXUS is locked')).toBeTruthy();
  });

  it('leaves the app on back while locked', async () => {
    mockUnlock.mockResolvedValue(false);
    let onBack: (() => boolean) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, fn) => {
      onBack = fn as () => boolean;
      return { remove: jest.fn() };
    });
    const exit = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => undefined);
    await app();
    expect(onBack!()).toBe(true);
    expect(exit).toHaveBeenCalled();
  });
});
