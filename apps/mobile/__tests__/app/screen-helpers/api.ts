// Fake server responses for a mocked `api` (src/infra/apiClient), keyed by
// "METHOD /path". A handler may return a value or throw to simulate errors.

export type ApiHandler = (body: unknown) => unknown;
export type ApiRoutes = Record<string, ApiHandler | object | null | undefined>;

export function serveApi(mock: jest.Mock, routes: ApiRoutes): void {
  mock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (!(key in routes)) throw new Error(`Unexpected API call ${key}`);
    const r = routes[key];
    return typeof r === 'function' ? (r as ApiHandler)(init?.body) : r;
  });
}

export const me = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'amara@example.com',
  displayName: 'Amara',
  emailVerified: true,
  settings: { telemetryOptIn: false, push: { newDeviceSignIn: true } },
  deletionRequestedAt: null,
  createdAt: '2026-01-15T10:00:00.000Z',
  ...over,
});
