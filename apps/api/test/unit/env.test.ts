import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';

// Test-only switches must never reach production: the server refuses to start.
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db.example/nexus',
  JWT_SECRET: 'a'.repeat(43),
};

describe('loadEnv guards', () => {
  it('accepts a production configuration with the defaults', () => {
    expect(loadEnv(production)).toMatchObject({ E2E_MODE: false, RATE_LIMIT_MULTIPLIER: 1 });
  });

  it('refuses E2E_MODE in production', () => {
    expect(() => loadEnv({ ...production, E2E_MODE: 'true' })).toThrow(/E2E_MODE/);
  });

  it('refuses a raised rate-limit multiplier in production', () => {
    expect(() => loadEnv({ ...production, RATE_LIMIT_MULTIPLIER: '100' })).toThrow(
      /RATE_LIMIT_MULTIPLIER/,
    );
  });

  it('treats empty values as unset, as hosting dashboards can leave them', () => {
    const env = loadEnv({
      ...production,
      APP_URL: '',
      CORS_ORIGINS: '',
      DATABASE_URL_MAINT: '',
      BACKUP_AGE_RECIPIENT: '  ',
      EXPO_ACCESS_TOKEN: '',
    });
    expect(env.APP_URL).toBe('http://localhost:8081');
    expect(env.DATABASE_URL_MAINT).toBeUndefined();
    expect(env.BACKUP_AGE_RECIPIENT).toBeUndefined();
  });

  it('allows the multiplier outside production', () => {
    expect(loadEnv({ NODE_ENV: 'test', RATE_LIMIT_MULTIPLIER: '100' }).RATE_LIMIT_MULTIPLIER).toBe(
      100,
    );
  });
});
