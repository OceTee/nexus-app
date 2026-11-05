// Lifetimes and limits from TDD Sections F and H.

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const VERIFY_TOKEN_TTL_HOURS = 24;
export const RESET_TOKEN_TTL_MINUTES = 30;
export const JWT_CLOCK_TOLERANCE_SECONDS = 60;
export const DELETION_GRACE_DAYS = 30;

/** Rate limits (TDD Section F, Rate limiting). Durations in seconds. */
export const RATE_LIMITS = {
  authBurst: { points: 10, duration: 15 * 60 },
  loginFailures: { points: 5, duration: 15 * 60, lockSeconds: 15 * 60 },
  refresh: { points: 30, duration: 60 * 60 },
  resendVerification: { points: 1, duration: 5 * 60 },
  general: { points: 600, duration: 15 * 60 },
  sync: { points: 120, duration: 60 * 60 },
  syncNudge: { points: 1, duration: 30 },
  emailsPerUserPerDay: { points: 20, duration: 24 * 60 * 60 },
} as const;
