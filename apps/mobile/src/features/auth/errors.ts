import { ApiError } from '../../infra/apiClient';

/** A user-facing message for an auth API error (no account enumeration). */
export function authErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Try again.';
  if (err.isNetwork) return 'You are offline. Connect to the internet and try again.';
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return 'Email or password is incorrect.';
    case 'LOCKED':
      return `Too many attempts. Try again in ${Math.ceil((err.retryAfter ?? 900) / 60)} minutes.`;
    case 'RATE_LIMITED':
      return `Too many requests. Try again in ${Math.ceil((err.retryAfter ?? 60) / 60)} minute(s).`;
    case 'DUPLICATE':
      return 'An account with this email already exists. Sign in instead.';
    case 'TOKEN_INVALID':
      return 'This link is not valid or was already used.';
    case 'TOKEN_EXPIRED':
      return 'This link has expired. Request a new one.';
    default:
      return err.message || 'Something went wrong. Try again.';
  }
}

/** Field errors from a 400 VALIDATION_FAILED response, keyed by field name. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_FAILED' || !Array.isArray(err.details))
    return {};
  const out: Record<string, string> = {};
  for (const d of err.details as { path?: unknown[]; message?: string }[]) {
    const field = d.path?.[0];
    if (typeof field === 'string' && d.message && !out[field]) out[field] = d.message;
  }
  return out;
}
