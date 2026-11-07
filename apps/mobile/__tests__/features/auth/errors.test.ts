import { authErrorMessage, fieldErrors } from '../../../src/features/auth/errors';
import { ApiError } from '../../../src/infra/apiClient';

describe('authErrorMessage', () => {
  it('uses a generic message for unknown errors', () => {
    expect(authErrorMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
    expect(authErrorMessage('nope')).toBe('Something went wrong. Try again.');
  });

  it('explains network failures', () => {
    expect(authErrorMessage(new ApiError(0, 'NETWORK', 'offline'))).toBe(
      'You are offline. Connect to the internet and try again.',
    );
  });

  it.each([
    ['INVALID_CREDENTIALS', 'Email or password is incorrect.'],
    ['DUPLICATE', 'An account with this email already exists. Sign in instead.'],
    ['TOKEN_INVALID', 'This link is not valid or was already used.'],
    ['TOKEN_EXPIRED', 'This link has expired. Request a new one.'],
  ])('maps %s', (code, message) => {
    expect(authErrorMessage(new ApiError(400, code, 'server text'))).toBe(message);
  });

  it('rounds lockout and rate-limit waits up to minutes', () => {
    expect(authErrorMessage(new ApiError(423, 'LOCKED', '', undefined, 61))).toBe(
      'Too many attempts. Try again in 2 minutes.',
    );
    expect(authErrorMessage(new ApiError(423, 'LOCKED', ''))).toBe(
      'Too many attempts. Try again in 15 minutes.',
    );
    expect(authErrorMessage(new ApiError(429, 'RATE_LIMITED', '', undefined, 150))).toBe(
      'Too many requests. Try again in 3 minute(s).',
    );
    expect(authErrorMessage(new ApiError(429, 'RATE_LIMITED', ''))).toBe(
      'Too many requests. Try again in 1 minute(s).',
    );
  });

  it('falls back to the server message, then a generic one', () => {
    expect(authErrorMessage(new ApiError(500, 'INTERNAL', 'Server says no'))).toBe(
      'Server says no',
    );
    expect(authErrorMessage(new ApiError(500, 'INTERNAL', ''))).toBe(
      'Something went wrong. Try again.',
    );
  });
});

describe('fieldErrors', () => {
  it('returns nothing for other errors', () => {
    expect(fieldErrors(new Error('x'))).toEqual({});
    expect(fieldErrors(new ApiError(409, 'DUPLICATE', 'x', []))).toEqual({});
    expect(fieldErrors(new ApiError(400, 'VALIDATION_FAILED', 'x', 'not a list'))).toEqual({});
  });

  it('keeps the first message per field and skips malformed entries', () => {
    const err = new ApiError(400, 'VALIDATION_FAILED', 'bad', [
      { path: ['email'], message: 'Invalid email' },
      { path: ['email'], message: 'Second message' },
      { path: ['password'], message: 'Too short' },
      { path: [0], message: 'Numeric path' },
      { path: ['displayName'] },
      { message: 'No path' },
    ]);
    expect(fieldErrors(err)).toEqual({ email: 'Invalid email', password: 'Too short' });
  });
});
