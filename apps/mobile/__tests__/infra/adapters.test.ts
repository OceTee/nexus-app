// Small native adapters: secure storage, biometrics, preferences, and the
// query client's retry rule.

import * as SecureStore from 'expo-secure-store';
import { queryClient } from '../../src/data/queries/client';
import { ApiError } from '../../src/infra/apiClient';
import { canUseLock, unlock } from '../../src/infra/biometrics';
import { kv } from '../../src/infra/kv';
import { secureStore } from '../../src/infra/secureStore';

// Each factory keeps its own state (jest.mock runs before this file's
// variables exist); tests reach it through jest.requireMock.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'unlocked-this-device',
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});
jest.mock('expo-local-authentication', () => {
  const auth = { level: 2, success: true, throws: false };
  return {
    __auth: auth,
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_STRONG: 2 },
    getEnrolledLevelAsync: jest.fn(async () => {
      if (auth.throws) throw new Error('unavailable');
      return auth.level;
    }),
    authenticateAsync: jest.fn(async () => ({ success: auth.success })),
  };
});
jest.mock('expo-sqlite/kv-store', () => {
  const data = new Map<string, string>();
  const state = { throws: false };
  const guard = <T>(f: () => T): T => {
    if (state.throws) throw new Error('kv broken');
    return f();
  };
  return {
    __esModule: true,
    __state: state,
    default: {
      getItemSync: (k: string) => guard(() => data.get(k) ?? null),
      setItemSync: (k: string, v: string) => guard(() => void data.set(k, v)),
      removeItemSync: (k: string) => guard(() => void data.delete(k)),
    },
  };
});

const store = (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store;
const mockAuth = (
  jest.requireMock('expo-local-authentication') as {
    __auth: { level: number; success: boolean; throws: boolean };
  }
).__auth;
const kvState = (jest.requireMock('expo-sqlite/kv-store') as { __state: { throws: boolean } })
  .__state;

beforeEach(() => {
  store.clear();
  kvState.throws = false;
  Object.assign(mockAuth, { level: 2, success: true, throws: false });
});

describe('secureStore', () => {
  it('keeps the refresh token in the keystore, this device only', async () => {
    await secureStore.setRefreshToken('r1');
    expect(await secureStore.getRefreshToken()).toBe('r1');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('nexus.refreshToken', 'r1', {
      keychainAccessible: 'unlocked-this-device',
    });
    await secureStore.clearRefreshToken();
    expect(await secureStore.getRefreshToken()).toBeNull();
  });

  it('creates the device id once and keeps it', async () => {
    const first = await secureStore.deviceId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(await secureStore.deviceId()).toBe(first);
  });
});

describe('biometrics', () => {
  it('can lock when biometrics or a passcode is enrolled', async () => {
    expect(await canUseLock()).toBe(true);
    mockAuth.level = 0;
    expect(await canUseLock()).toBe(false);
    mockAuth.throws = true;
    expect(await canUseLock()).toBe(false);
  });

  it('reports whether unlocking succeeded', async () => {
    expect(await unlock('Unlock NEXUS')).toBe(true);
    mockAuth.success = false;
    expect(await unlock('Unlock NEXUS')).toBe(false);
  });
});

describe('kv', () => {
  it('stores strings and JSON, filling missing fields from the fallback', () => {
    kv.set('a', '1');
    expect(kv.get('a')).toBe('1');
    kv.remove('a');
    expect(kv.get('a')).toBeNull();
    kv.setJson('prefs', { theme: 'dark' });
    expect(kv.getJson('prefs', { theme: 'system', lock: 'never' })).toEqual({
      theme: 'dark',
      lock: 'never',
    });
  });

  it('falls back to defaults when the stored value is missing or broken', () => {
    expect(kv.getJson('nothing', { x: 1 })).toEqual({ x: 1 });
    kv.set('broken', '{not json');
    expect(kv.getJson('broken', { x: 1 })).toEqual({ x: 1 });
  });

  it('never throws, even when storage fails', () => {
    kvState.throws = true;
    expect(kv.get('a')).toBeNull();
    expect(() => kv.set('a', '1')).not.toThrow();
    expect(() => kv.remove('a')).not.toThrow();
  });
});

describe('query client retry rule', () => {
  const retry = queryClient.getDefaultOptions().queries!.retry as (
    count: number,
    err: unknown,
  ) => boolean;

  it('retries network and server errors twice, never client errors', () => {
    expect(retry(0, new Error('network'))).toBe(true);
    expect(retry(2, new Error('network'))).toBe(false);
    expect(retry(0, new ApiError(503, 'UNAVAILABLE', 'down'))).toBe(true);
    expect(retry(0, new ApiError(404, 'NOT_FOUND', 'gone'))).toBe(false);
  });
});
