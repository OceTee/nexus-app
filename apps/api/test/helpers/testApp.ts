import type { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import request from 'supertest';
import { expect, inject } from 'vitest';
import { createApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createContainer, type Container } from '../../src/container';
import { createDb, type DbHandle } from '../../src/db/client';
import { MemorySender } from '../../src/integrations/email';
import { MemoryPushSender } from '../../src/integrations/push';
import { MemoryQueue } from '../../src/jobs/queue';
import { createLogger } from '../../src/lib/logger';

/** Shared pools for one test file (as nexus_api and as the owner). */
export interface Pools {
  api: DbHandle;
  owner: DbHandle;
}

export function openPools(): Pools {
  return {
    api: createDb(inject('apiUrl'), { max: 4 }),
    owner: createDb(inject('ownerUrl'), { max: 2 }),
  };
}

export async function closePools(p: Pools): Promise<void> {
  await p.api.close();
  await p.owner.close();
}

export interface TestApp {
  http: ReturnType<typeof request>;
  container: Container;
  queue: MemoryQueue;
  mail: MemorySender;
  push: MemoryPushSender;
  /** Runs queued jobs (emails, pushes). */
  drain(): Promise<void>;
}

let counter = 0;

/**
 * An app wired to the real database (RLS via nexus_api), with in-memory queue,
 * email and push, and a fresh rate-limit namespace in the Postgres store.
 */
export async function makeApp(pools: Pools): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    APP_URL: 'https://app.nexus.example',
  });
  const logger = createLogger(env);
  const queue = new MemoryQueue();
  const mail = new MemorySender();
  const push = new MemoryPushSender();
  const container = createContainer({
    env,
    logger,
    db: pools.api.db,
    pool: pools.api.pool,
    queue,
    email: mail,
    push,
    limiterStore: { kind: 'postgres', pool: pools.api.pool, prefix: `t${Date.now()}-${++counter}` },
  });
  await queue.work(container.jobHandlers);
  const app = createApp({ env, logger, container });
  return { http: request(app), container, queue, mail, push, drain: () => queue.drain() };
}

let emailCounter = 0;
export const uniqueEmail = () => `user${Date.now()}${++emailCounter}@example.com`;
export const STRONG_PASSWORD = 'correct-horse-battery-staple';

export const device = (name = 'Pixel 7') => ({
  id: uuidv7(),
  name,
  platform: 'android' as const,
  appVersion: '1.0.0',
});

/** Registers a user and returns the session plus credentials. */
export async function registerUser(
  t: TestApp,
  overrides: { email?: string; device?: ReturnType<typeof device> } = {},
) {
  const email = overrides.email ?? uniqueEmail();
  const dev = overrides.device ?? device();
  const res = await t.http
    .post('/v1/auth/register')
    .send({ email, password: STRONG_PASSWORD, displayName: 'Test', device: dev });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    email,
    device: dev,
    userId: res.body.user.id as string,
    accessToken: res.body.accessToken as string,
    refreshToken: res.body.refreshToken as string,
  };
}

/** Registers and verifies the email, then returns a fresh verified session. */
export async function verifiedUser(t: TestApp) {
  const u = await registerUser(t);
  await t.drain();
  const token = t.mail.lastToken(u.email);
  await t.http.post('/v1/auth/verify-email').send({ token }).expect(200);
  const refreshed = await t.http
    .post('/v1/auth/refresh')
    .send({ refreshToken: u.refreshToken, deviceId: u.device.id })
    .expect(200);
  return {
    ...u,
    accessToken: refreshed.body.accessToken as string,
    refreshToken: refreshed.body.refreshToken as string,
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Contract check (T-31): the body parses with its DTO and has no fields the
 * DTO does not declare (parsing strips unknown keys, so the result must equal
 * the original).
 */
export function expectShape<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  expect(parsed.data).toEqual(body);
  return parsed.data as z.output<S>;
}

/** Error envelope check (T-32). */
export function expectError(
  res: { status: number; body: unknown },
  status: number,
  code: string,
): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body).toMatchObject({
    error: { code, requestId: expect.any(String), message: expect.any(String) },
  });
}
