import * as LocalAuthentication from 'expo-local-authentication';

/** Whether the device can lock the app (biometrics or a device passcode is set up). */
export async function canUseLock(): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/** Asks for biometrics, falling back to the device passcode (TDD S-07, T-54). */
export async function unlock(prompt: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}
