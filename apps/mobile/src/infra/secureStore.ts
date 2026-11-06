// Secrets on the device (TDD Section G, Secure storage): the refresh token and
// the device id, in the Keychain / Android Keystore. The access token lives in
// memory only.

import * as SecureStore from 'expo-secure-store';
import { uuidv7 } from './ids';

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const KEYS = {
  refreshToken: 'nexus.refreshToken',
  deviceId: 'nexus.deviceId',
} as const;

export const secureStore = {
  getRefreshToken: () => SecureStore.getItemAsync(KEYS.refreshToken, OPTS),
  setRefreshToken: (token: string) => SecureStore.setItemAsync(KEYS.refreshToken, token, OPTS),
  clearRefreshToken: () => SecureStore.deleteItemAsync(KEYS.refreshToken, OPTS),

  /** Stable per-install device id (UUIDv7), created on first use. */
  async deviceId(): Promise<string> {
    const existing = await SecureStore.getItemAsync(KEYS.deviceId, OPTS);
    if (existing) return existing;
    const id = uuidv7();
    await SecureStore.setItemAsync(KEYS.deviceId, id, OPTS);
    return id;
  },
};
