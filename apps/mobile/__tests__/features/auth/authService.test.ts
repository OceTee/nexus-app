import {
  changePassword,
  currentDevice,
  fetchMe,
  forgotPassword,
  refreshSession,
  register,
  resendVerification,
  resetPassword,
  restoreSession,
  signIn,
  signOut,
  tokenFromInput,
  verifyEmail,
} from '../../../src/features/auth/authService';
import { api, ApiError, setAuthHooks } from '../../../src/infra/apiClient';
import { secureStore } from '../../../src/infra/secureStore';
import { cachedUser, useSessionStore, wasLocalMode } from '../../../src/stores/session';

jest.mock('expo-device', () => ({ deviceName: 'Amara’s Pixel', modelName: 'Pixel 8' }));
jest.mock('../../../src/infra/apiClient', () => ({
  ...jest.requireActual('../../../src/infra/apiClient'),
  api: jest.fn(),
  setAuthHooks: jest.fn(),
}));
jest.mock('../../../src/infra/secureStore', () => ({
  secureStore: {
    getRefreshToken: jest.fn(),
    setRefreshToken: jest.fn(),
    clearRefreshToken: jest.fn(),
    deviceId: jest.fn(),
  },
}));
jest.mock('../../../src/stores/session', () => ({
  ...jest.requireActual('../../../src/stores/session'),
  cachedUser: jest.fn(),
  wasLocalMode: jest.fn(),
}));

const mockApi = api as jest.MockedFunction<typeof api>;
const store = secureStore as jest.Mocked<typeof secureStore>;

const user = {
  id: 'u1',
  email: 'amara@example.com',
  displayName: 'Amara',
  emailVerified: false,
  createdAt: '2026-01-01',
};
const session = {
  user,
  deviceId: 'dev-1',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
};
/** An unsigned JWT with the given claims (base64url, no padding). */
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

beforeEach(() => {
  jest.clearAllMocks();
  store.deviceId.mockResolvedValue('dev-1');
  store.getRefreshToken.mockResolvedValue(null);
  useSessionStore.setState({ status: 'anon', user: null, accessToken: null, deviceId: null });
});

describe('currentDevice', () => {
  it('describes this device', async () => {
    expect(await currentDevice()).toEqual({
      id: 'dev-1',
      name: 'Amara’s Pixel',
      platform: 'ios',
      appVersion: expect.any(String),
    });
  });
});

describe('register and signIn', () => {
  it.each([
    ['register', () => register({ email: 'a@b.c', password: 'pw' }), '/v1/auth/register'],
    ['signIn', () => signIn({ email: 'a@b.c', password: 'pw' }), '/v1/auth/login'],
  ])('%s stores the refresh token and signs in', async (_name, run, path) => {
    mockApi.mockResolvedValue(session);
    await run();
    expect(mockApi).toHaveBeenCalledWith(path, {
      method: 'POST',
      auth: false,
      body: { email: 'a@b.c', password: 'pw', device: expect.objectContaining({ id: 'dev-1' }) },
    });
    expect(store.setRefreshToken).toHaveBeenCalledWith('refresh-1');
    expect(useSessionStore.getState()).toMatchObject({
      status: 'authed',
      deviceId: 'dev-1',
      accessToken: 'access-1',
      user: { id: 'u1', emailVerified: false },
    });
  });
});

describe('refreshSession', () => {
  it('returns null without a refresh token', async () => {
    expect(await refreshSession()).toBeNull();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('rotates the tokens and picks up email verification', async () => {
    useSessionStore
      .getState()
      .setAuthed({ id: 'u1', email: 'a', displayName: 'A', emailVerified: false }, 'dev-1', null);
    store.getRefreshToken.mockResolvedValue('old');
    const access = jwt({ sub: 'u1', ver: true });
    mockApi.mockResolvedValue({ accessToken: access, refreshToken: 'new' });

    expect(await refreshSession()).toBe(access);
    expect(mockApi).toHaveBeenCalledWith('/v1/auth/refresh', {
      method: 'POST',
      auth: false,
      body: { refreshToken: 'old', deviceId: 'dev-1' },
    });
    expect(store.setRefreshToken).toHaveBeenCalledWith('new');
    expect(useSessionStore.getState().accessToken).toBe(access);
    expect(useSessionStore.getState().user?.emailVerified).toBe(true);
  });

  it('ignores an access token it cannot decode', async () => {
    store.getRefreshToken.mockResolvedValue('old');
    mockApi.mockResolvedValue({ accessToken: 'not-a-jwt', refreshToken: 'new' });
    expect(await refreshSession()).toBe('not-a-jwt');
  });

  it('expires the session when the server rejects the token', async () => {
    useSessionStore
      .getState()
      .setAuthed({ id: 'u1', email: 'a', displayName: 'A', emailVerified: true }, 'dev-1', 'x');
    store.getRefreshToken.mockResolvedValue('old');
    mockApi.mockRejectedValue(new ApiError(401, 'TOKEN_INVALID', 'no'));
    expect(await refreshSession()).toBeNull();
    expect(store.clearRefreshToken).toHaveBeenCalled();
    expect(useSessionStore.getState().sessionExpired).toBe(true);
  });

  it('keeps the session when offline', async () => {
    store.getRefreshToken.mockResolvedValue('old');
    mockApi.mockRejectedValue(new ApiError(0, 'NETWORK', 'offline'));
    expect(await refreshSession()).toBeNull();
    expect(store.clearRefreshToken).not.toHaveBeenCalled();
  });
});

describe('restoreSession', () => {
  it('installs auth hooks and restores a cached signed-in user', async () => {
    const cached = { id: 'u1', email: 'a', displayName: 'A', emailVerified: true };
    (cachedUser as jest.Mock).mockReturnValue(cached);
    store.getRefreshToken.mockResolvedValue('r');
    mockApi.mockRejectedValue(new ApiError(0, 'NETWORK', 'offline'));

    await restoreSession();

    expect(setAuthHooks).toHaveBeenCalledTimes(1);
    const hooks = (setAuthHooks as jest.Mock).mock.calls[0][0];
    useSessionStore.setState({ accessToken: 'tok' });
    expect(hooks.getAccessToken()).toBe('tok');
    expect(hooks.refresh).toBe(refreshSession);
    expect(useSessionStore.getState()).toMatchObject({ status: 'authed', user: cached });
  });

  it('returns to local mode', async () => {
    (cachedUser as jest.Mock).mockReturnValue(null);
    (wasLocalMode as jest.Mock).mockReturnValue(true);
    await restoreSession();
    expect(useSessionStore.getState().status).toBe('local');
  });

  it('otherwise starts signed out', async () => {
    (cachedUser as jest.Mock).mockReturnValue(null);
    (wasLocalMode as jest.Mock).mockReturnValue(false);
    await restoreSession();
    expect(useSessionStore.getState().status).toBe('anon');
  });
});

describe('signOut', () => {
  it('logs out on the server when it can, and always locally', async () => {
    store.getRefreshToken.mockResolvedValue('r');
    mockApi.mockRejectedValue(new Error('offline'));
    useSessionStore.setState({ status: 'authed' });
    await signOut();
    expect(mockApi).toHaveBeenCalledWith('/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken: 'r' },
    });
    expect(store.clearRefreshToken).toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('anon');
  });

  it('skips the server without a refresh token', async () => {
    await signOut();
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('verifyEmail', () => {
  it('marks a signed-in user verified and refreshes', async () => {
    useSessionStore
      .getState()
      .setAuthed({ id: 'u1', email: 'a', displayName: 'A', emailVerified: false }, 'dev-1', null);
    mockApi.mockResolvedValue(undefined);
    await verifyEmail('tok');
    expect(mockApi).toHaveBeenCalledWith('/v1/auth/verify-email', {
      method: 'POST',
      auth: false,
      body: { token: 'tok' },
    });
    expect(useSessionStore.getState().user?.emailVerified).toBe(true);
    expect(store.getRefreshToken).toHaveBeenCalled();
  });

  it('only calls the API when signed out', async () => {
    mockApi.mockResolvedValue(undefined);
    await verifyEmail('tok');
    expect(store.getRefreshToken).not.toHaveBeenCalled();
  });
});

describe('simple calls', () => {
  beforeEach(() => mockApi.mockResolvedValue(undefined));

  it('send the expected requests', async () => {
    await resendVerification();
    await forgotPassword('a@b.c');
    await resetPassword('tok', 'pw');
    await fetchMe();
    expect(mockApi.mock.calls).toEqual([
      ['/v1/auth/resend-verification', { method: 'POST' }],
      ['/v1/auth/forgot-password', { method: 'POST', auth: false, body: { email: 'a@b.c' } }],
      [
        '/v1/auth/reset-password',
        { method: 'POST', auth: false, body: { token: 'tok', password: 'pw' } },
      ],
      ['/v1/me'],
    ]);
  });

  it('changePassword stores the new tokens', async () => {
    mockApi.mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2' });
    await changePassword({ currentPassword: 'old', newPassword: 'new' });
    expect(store.setRefreshToken).toHaveBeenCalledWith('r2');
    expect(useSessionStore.getState().accessToken).toBe('a2');
  });
});

describe('tokenFromInput', () => {
  it('extracts the token from a pasted link', () => {
    expect(tokenFromInput(' https://nexus.app/verify?token=abc%2Bdef&x=1 ')).toBe('abc+def');
    expect(tokenFromInput('nexus://reset?a=1&token=xyz#frag')).toBe('xyz');
  });

  it('returns a bare token trimmed', () => {
    expect(tokenFromInput('  raw-token ')).toBe('raw-token');
  });
});
