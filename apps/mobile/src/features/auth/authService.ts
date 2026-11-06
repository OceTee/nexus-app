// Auth flows against /v1/auth (TDD Sections D and H). The session store holds
// the state; this module talks to the API and SecureStore.

import type {
  AuthSessionDto,
  ChangePasswordInput,
  DeviceRegisterInput,
  TokenPairDto,
  UserDto,
} from '@nexus/shared';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api, ApiError, setAuthHooks } from '../../infra/apiClient';
import { APP_VERSION } from '../../infra/config';
import { secureStore } from '../../infra/secureStore';
import { cachedUser, toSessionUser, useSessionStore, wasLocalMode } from '../../stores/session';

/** This device as the API expects it. */
export async function currentDevice(): Promise<DeviceRegisterInput> {
  const name = (Device.deviceName || Device.modelName || 'Phone').slice(0, 60);
  return {
    id: await secureStore.deviceId(),
    name,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    appVersion: APP_VERSION,
  };
}

async function adopt(session: AuthSessionDto): Promise<void> {
  await secureStore.setRefreshToken(session.refreshToken);
  useSessionStore
    .getState()
    .setAuthed(toSessionUser(session.user), session.deviceId, session.accessToken);
}

export async function register(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<void> {
  const session = await api<AuthSessionDto>('/v1/auth/register', {
    method: 'POST',
    auth: false,
    body: { ...input, device: await currentDevice() },
  });
  await adopt(session);
}

export async function signIn(input: { email: string; password: string }): Promise<void> {
  const session = await api<AuthSessionDto>('/v1/auth/login', {
    method: 'POST',
    auth: false,
    body: { ...input, device: await currentDevice() },
  });
  await adopt(session);
}

/**
 * Rotates the refresh token for a new access token. Returns null and signs
 * out only when the server rejects the token; offline keeps the session.
 */
export async function refreshSession(): Promise<string | null> {
  const refreshToken = await secureStore.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const pair = await api<TokenPairDto>('/v1/auth/refresh', {
      method: 'POST',
      auth: false,
      body: { refreshToken, deviceId: await secureStore.deviceId() },
    });
    await secureStore.setRefreshToken(pair.refreshToken);
    useSessionStore.getState().setAccessToken(pair.accessToken);
    const claims = decodeClaims(pair.accessToken);
    if (claims?.ver !== undefined) useSessionStore.getState().setEmailVerified(claims.ver);
    return pair.accessToken;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Token expired, reused or revoked: local notes and queued changes stay;
      // the app keeps working offline and asks to sign in again to sync.
      await secureStore.clearRefreshToken();
      useSessionStore.getState().expire();
    }
    return null;
  }
}

/** Restores the session on launch without waiting for the network. */
export async function restoreSession(): Promise<void> {
  setAuthHooks({
    getAccessToken: () => useSessionStore.getState().accessToken,
    refresh: refreshSession,
  });
  const [refreshToken, deviceId] = await Promise.all([
    secureStore.getRefreshToken(),
    secureStore.deviceId(),
  ]);
  const user = cachedUser();
  if (refreshToken && user) {
    useSessionStore.getState().setAuthed(user, deviceId, null);
    void refreshSession(); // renews in the background; offline is fine
    return;
  }
  if (wasLocalMode()) {
    useSessionStore.getState().continueOffline();
    return;
  }
  useSessionStore.getState().signedOut();
}

export async function signOut(): Promise<void> {
  const refreshToken = await secureStore.getRefreshToken();
  if (refreshToken) {
    try {
      await api('/v1/auth/logout', { method: 'POST', body: { refreshToken } });
    } catch {
      // signing out works offline too
    }
  }
  await secureStore.clearRefreshToken();
  useSessionStore.getState().signedOut();
}

export async function verifyEmail(token: string): Promise<void> {
  await api('/v1/auth/verify-email', { method: 'POST', auth: false, body: { token } });
  if (useSessionStore.getState().status === 'authed') {
    useSessionStore.getState().setEmailVerified(true);
    await refreshSession(); // the next access token carries ver: true
  }
}

export function resendVerification(): Promise<void> {
  return api('/v1/auth/resend-verification', { method: 'POST' });
}

export function forgotPassword(email: string): Promise<void> {
  return api('/v1/auth/forgot-password', { method: 'POST', auth: false, body: { email } });
}

export function resetPassword(token: string, password: string): Promise<void> {
  return api('/v1/auth/reset-password', { method: 'POST', auth: false, body: { token, password } });
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const pair = await api<TokenPairDto>('/v1/auth/change-password', { method: 'POST', body: input });
  await secureStore.setRefreshToken(pair.refreshToken);
  useSessionStore.getState().setAccessToken(pair.accessToken);
}

export function fetchMe(): Promise<UserDto> {
  return api<UserDto>('/v1/me');
}

/** Pulls the token out of a pasted link (`…/verify?token=…`) or returns the input. */
export function tokenFromInput(input: string): string {
  const trimmed = input.trim();
  const match = /[?&]token=([^&\s#]+)/.exec(trimmed);
  return match ? decodeURIComponent(match[1]!) : trimmed;
}

function decodeClaims(jwt: string): { ver?: boolean } | null {
  try {
    const part = jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(
      globalThis.atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')),
    ) as {
      ver?: boolean;
    };
  } catch {
    return null;
  }
}
