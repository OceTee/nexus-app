import { api, ApiError, setAuthHooks } from '../../src/infra/apiClient';
import { tokenFromInput } from '../../src/features/auth/authService';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => setAuthHooks(null));

  it('sends a request id and the bearer token, and parses JSON', async () => {
    setAuthHooks({ getAccessToken: () => 'token-1', refresh: async () => null });
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api('/v1/me')).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe('Bearer token-1');
    expect(init.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refreshes once for concurrent 401s and retries each request', async () => {
    let token = 'old';
    const refresh = jest.fn(async () => {
      token = 'new';
      return 'new';
    });
    setAuthHooks({ getAccessToken: () => token, refresh });
    fetchMock.mockImplementation(async (_url: string, init: { headers: Record<string, string> }) =>
      init.headers.authorization === 'Bearer new'
        ? json(200, { ok: true })
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired', requestId: 'r' } }),
    );
    await expect(Promise.all([api('/v1/me'), api('/v1/devices')])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('turns error envelopes and network failures into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow down', requestId: 'r' } }),
        {
          status: 429,
          headers: { 'retry-after': '42' },
        },
      ),
    );
    await expect(
      api('/v1/auth/login', { method: 'POST', auth: false, body: {} }),
    ).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfter: 42,
    });
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const err = await api('/healthz', { auth: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isNetwork).toBe(true);
  });

  it('returns undefined for 202 and 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(
      api('/v1/auth/forgot-password', { method: 'POST', auth: false, body: {} }),
    ).resolves.toBeUndefined();
  });
});

describe('tokenFromInput', () => {
  it('accepts a pasted link or a bare token', () => {
    expect(tokenFromInput(' https://app.nexus.example/verify?token=abc_DEF-123 ')).toBe(
      'abc_DEF-123',
    );
    expect(tokenFromInput('http://localhost:8081/reset?x=1&token=a%2Bb')).toBe('a+b');
    expect(tokenFromInput('rawtoken')).toBe('rawtoken');
  });
});
