// Session state (TDD Section G, State management).
//   loading — restoring on launch
//   anon    — no account and no local-only choice yet: auth screens
//   local   — "Continue offline": the app works, nothing syncs (Journey 1)
//   authed  — signed in; the refresh token is in SecureStore, the access token in memory

import type { UserDto } from '@nexus/shared';
import { create } from 'zustand';
import { kv } from '../infra/kv';

export type SessionStatus = 'loading' | 'anon' | 'local' | 'authed';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

interface SessionStore {
  status: SessionStatus;
  user: SessionUser | null;
  deviceId: string | null;
  accessToken: string | null;
  /** A deep link opened while signed out, replayed after sign-in. */
  pendingLink: string | null;
  setAuthed(user: SessionUser, deviceId: string, accessToken: string | null): void;
  setAccessToken(token: string | null): void;
  setEmailVerified(verified: boolean): void;
  continueOffline(): void;
  signedOut(): void;
  setPendingLink(link: string | null): void;
}

const USER_KEY = 'session.user';
const LOCAL_KEY = 'session.localMode';

export function toSessionUser(u: UserDto): SessionUser {
  return { id: u.id, email: u.email, displayName: u.displayName, emailVerified: u.emailVerified };
}

/** Cached profile for offline launches (not secret). */
export function cachedUser(): SessionUser | null {
  const u = kv.getJson<SessionUser | null>(USER_KEY, null as never);
  return u && typeof u === 'object' && 'id' in u ? u : null;
}

export function wasLocalMode(): boolean {
  return kv.get(LOCAL_KEY) === '1';
}

export const useSessionStore = create<SessionStore>()((set, get) => ({
  status: 'loading',
  user: null,
  deviceId: null,
  accessToken: null,
  pendingLink: null,
  setAuthed(user, deviceId, accessToken) {
    kv.setJson(USER_KEY, user);
    kv.remove(LOCAL_KEY);
    set({ status: 'authed', user, deviceId, accessToken });
  },
  setAccessToken(accessToken) {
    set({ accessToken });
  },
  setEmailVerified(emailVerified) {
    const user = get().user;
    if (!user) return;
    const next = { ...user, emailVerified };
    kv.setJson(USER_KEY, next);
    set({ user: next });
  },
  continueOffline() {
    kv.set(LOCAL_KEY, '1');
    set({ status: 'local', user: null, accessToken: null });
  },
  signedOut() {
    kv.remove(USER_KEY);
    kv.remove(LOCAL_KEY);
    set({ status: 'anon', user: null, accessToken: null });
  },
  setPendingLink(pendingLink) {
    set({ pendingLink });
  },
}));
