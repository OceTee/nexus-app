import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';

// The real seed rewrites the demo account in Postgres; here it only records calls.
const seedDemo = vi.fn().mockResolvedValue({ notes: 3 });
vi.mock('../../src/db/seed/seedDemo', () => ({ seedDemo }));
vi.mock('../../src/modules/auth/password', () => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
}));
const { createJobHandlers } = await import('../../src/jobs/handlers');
const { SCHEDULES } = await import('../../src/jobs/queue');

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;
const maintenance = { db: { tag: 'maint-db' } } as never;
const handlers = (demoPassword?: string) =>
  createJobHandlers({
    db: {} as never,
    logger,
    email: {} as never,
    push: {} as never,
    limiters: {} as never,
    exports: {} as never,
    maintenance,
    ...(demoPassword ? { demoPassword } : {}),
  });

describe('demo.reset', () => {
  it('is scheduled nightly', () => {
    expect(SCHEDULES['demo.reset']).toBe('30 5 * * *');
  });

  it('does nothing without a demo password', async () => {
    await handlers()['demo.reset']({});
    expect(seedDemo).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('demo.reset skipped: DEMO_PASSWORD is not set');
  });

  it('restores the demo account with the hashed password', async () => {
    await handlers('demo-password-123')['demo.reset']({});
    expect(seedDemo).toHaveBeenCalledWith({ tag: 'maint-db' }, 'hashed:demo-password-123');
  });
});
