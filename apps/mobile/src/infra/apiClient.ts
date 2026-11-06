// HTTP client for the NEXUS API (TDD Section G). Adds X-Request-Id and the
// bearer token, parses the error envelope into ApiError, and on a 401 for an
// expired access token refreshes once (shared by concurrent callers) and
// retries the request.

import { API_URL, REQUEST_TIMEOUT_MS } from './config';
import { uuidv7 } from './ids';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** No response at all (offline, DNS, timeout). */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export interface AuthHooks {
  /** Current access token (memory only). */
  getAccessToken(): string | null;
  /** Gets a new access token; resolves null when the session cannot be renewed. */
  refresh(): Promise<string | null>;
}

let hooks: AuthHooks | null = null;
let refreshing: Promise<string | null> | null = null;

export function setAuthHooks(h: AuthHooks | null): void {
  hooks = h;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send the bearer token (default true). */
  auth?: boolean;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => controller.abort());
  try {
    return await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        accept: 'application/json',
        'x-request-id': uuidv7(),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(0, 'NETWORK', 'Could not reach the NEXUS server', String(err));
  } finally {
    clearTimeout(timer);
  }
}

async function toError(res: Response): Promise<ApiError> {
  const retryAfter = Number(res.headers.get('retry-after')) || undefined;
  try {
    const body = (await res.json()) as {
      error?: { code: string; message: string; details?: unknown };
    };
    if (body.error)
      return new ApiError(
        res.status,
        body.error.code,
        body.error.message,
        body.error.details,
        retryAfter,
      );
  } catch {
    // not JSON
  }
  return new ApiError(
    res.status,
    'HTTP_' + res.status,
    res.statusText || 'Request failed',
    undefined,
    retryAfter,
  );
}

function refreshOnce(): Promise<string | null> {
  refreshing ??= (hooks?.refresh() ?? Promise.resolve(null)).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Calls the API and returns the parsed JSON (undefined for 202/204). */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const useAuth = opts.auth ?? true;
  let token = useAuth ? (hooks?.getAccessToken() ?? null) : null;
  if (useAuth && !token) token = await refreshOnce();

  let res = await send(path, opts, token);
  if (res.status === 401 && useAuth) {
    const err = await toError(res);
    if (err.code === 'TOKEN_EXPIRED' || err.code === 'UNAUTHENTICATED') {
      const renewed = await refreshOnce();
      if (!renewed) throw err;
      res = await send(path, opts, renewed);
    } else {
      throw err;
    }
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 202 || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
