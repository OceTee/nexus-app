import { AuthSessionDto, TokenPairDto, UserDto } from '@nexus/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import { sha256 } from '../../src/lib/tokens';
import {
  bearer,
  closePools,
  device,
  expectError,
  expectShape,
  makeApp,
  openPools,
  registerUser,
  STRONG_PASSWORD,
  uniqueEmail,
  type Pools,
} from '../helpers/testApp';

let pools: Pools;
beforeAll(() => {
  pools = openPools();
});
afterAll(() => closePools(pools));

describe('T-15 register and login', () => {
  it('registers, queues a verification email, then logs in with the same credentials', async () => {
    const t = await makeApp(pools);
    const email = uniqueEmail();
    const dev = device();

    const reg = await t.http.post('/v1/auth/register').send({
      email: email.toUpperCase(),
      password: STRONG_PASSWORD,
      displayName: 'Amara',
      device: dev,
    });
    expect(reg.status).toBe(201);
    const session = expectShape(AuthSessionDto, reg.body);
    expect(session.user).toMatchObject({ email, displayName: 'Amara', emailVerified: false });
    expect(session.deviceId).toBe(dev.id);

    expect(t.queue.sent.map((j) => j.name)).toEqual(['email.send']);
    await t.drain();
    expect(t.mail.outbox[0]).toMatchObject({ to: email, subject: 'Confirm your email for NEXUS' });
    expect(t.mail.lastToken(email)).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const login = await t.http
      .post('/v1/auth/login')
      .send({ email, password: STRONG_PASSWORD, device: dev });
    expect(login.status).toBe(200);
    expectShape(AuthSessionDto, login.body);

    const devices = await pools.owner.db
      .select()
      .from(s.devices)
      .where(eq(s.devices.userId, session.user.id));
    expect(devices).toHaveLength(1);
    // The same device signing in again is not "new": no alert.
    expect(t.queue.sent.filter((j) => j.name === 'push.send')).toHaveLength(0);
  });

  it('stores only hashes of refresh and email tokens', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const tokens = await pools.owner.db
      .select()
      .from(s.refreshTokens)
      .where(eq(s.refreshTokens.userId, u.userId));
    expect(tokens[0]!.tokenHash).toBe(sha256(u.refreshToken));
    expect(JSON.stringify(tokens)).not.toContain(u.refreshToken);
  });

  it('rejects a duplicate email with 409 DUPLICATE', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const res = await t.http
      .post('/v1/auth/register')
      .send({ email: u.email, password: STRONG_PASSWORD, device: device() });
    expectError(res, 409, 'DUPLICATE');
  });

  it('rejects weak passwords and disposable domains with field details', async () => {
    const t = await makeApp(pools);
    const weak = await t.http
      .post('/v1/auth/register')
      .send({ email: uniqueEmail(), password: 'password1', device: device() });
    expectError(weak, 400, 'VALIDATION_FAILED');
    expect(weak.body.error.details[0]).toMatchObject({
      path: ['password'],
      issue: 'weak_password',
    });

    const disposable = await t.http
      .post('/v1/auth/register')
      .send({ email: 'someone@mailinator.com', password: STRONG_PASSWORD, device: device() });
    expect(disposable.body.error.details[0]).toMatchObject({
      path: ['email'],
      issue: 'disposable_email',
    });
  });

  it('gives the same 401 for an unknown email and a wrong password, and audits both', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const unknown = await t.http
      .post('/v1/auth/login')
      .send({ email: uniqueEmail(), password: STRONG_PASSWORD, device: device() });
    const wrong = await t.http
      .post('/v1/auth/login')
      .send({ email: u.email, password: 'nope-nope-nope', device: u.device });
    expectError(unknown, 401, 'INVALID_CREDENTIALS');
    expectError(wrong, 401, 'INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);

    const audits = await pools.owner.db.execute(
      sql`SELECT user_id FROM audit_logs WHERE action = 'auth.login_failed' ORDER BY id DESC LIMIT 2`,
    );
    expect(audits.rows.map((r) => (r as { user_id: string | null }).user_id).sort()).toEqual(
      [null, u.userId].sort(),
    );
  });

  it('alerts other devices when a new device signs in', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    await pools.owner.db
      .update(s.devices)
      .set({ pushToken: 'ExponentPushToken[test-token-1]' })
      .where(eq(s.devices.id, u.device.id));
    t.queue.sent.length = 0;

    const tablet = device('Galaxy Tab');
    await t.http
      .post('/v1/auth/login')
      .send({ email: u.email, password: STRONG_PASSWORD, device: tablet })
      .expect(200);
    expect(t.queue.sent.map((j) => j.name).sort()).toEqual(['email.send', 'push.send']);
    await t.drain();
    expect(t.push.sent[0]).toMatchObject({
      tokens: ['ExponentPushToken[test-token-1]'],
      message: { title: 'New device signed in', data: { type: 'security.new-device' } },
    });
    expect(t.mail.outbox.at(-1)).toMatchObject({ to: u.email, subject: 'New sign-in to NEXUS' });
  });
});

describe('login lockout', () => {
  it('locks the account after five failures, even for the right password (423)', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    for (let i = 0; i < 5; i++) {
      const r = await t.http
        .post('/v1/auth/login')
        .send({ email: u.email, password: `wrong-${i}-xyz`, device: u.device });
      expectError(r, 401, 'INVALID_CREDENTIALS');
    }
    const locked = await t.http
      .post('/v1/auth/login')
      .send({ email: u.email, password: STRONG_PASSWORD, device: u.device });
    expectError(locked, 423, 'LOCKED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(800);
  });
});

describe('T-28 rate limit', () => {
  it('returns 429 with Retry-After on the 11th auth request from one IP', async () => {
    const t = await makeApp(pools);
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 11; i++) {
      last = await t.http
        .post('/v1/auth/login')
        .send({ email: uniqueEmail(), password: 'whatever-123', device: device() });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expectError(last!, 429, 'RATE_LIMITED');
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    expect(last!.headers['ratelimit-remaining']).toBe('0');
  });
});

describe('T-16 refresh rotation', () => {
  it('rotates, detects reuse, and revokes the whole family', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);

    const first = await t.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken, deviceId: u.device.id });
    expect(first.status).toBe(200);
    const pair = expectShape(TokenPairDto, first.body);
    expect(pair.refreshToken).not.toBe(u.refreshToken);

    const reuse = await t.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken, deviceId: u.device.id });
    expectError(reuse, 401, 'TOKEN_REUSED');

    const newest = await t.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: pair.refreshToken, deviceId: u.device.id });
    expect(newest.status).toBe(401);

    const audit = await pools.owner.db.execute(
      sql`SELECT count(*)::int AS n FROM audit_logs WHERE user_id = ${u.userId} AND action = 'auth.refresh_reuse'`,
    );
    expect((audit.rows[0] as { n: number }).n).toBe(1);
  });

  it('refuses a token presented by a different device', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const res = await t.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken, deviceId: device().id });
    expectError(res, 401, 'UNAUTHENTICATED');
  });

  it('refuses an expired token with TOKEN_EXPIRED', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    await pools.owner.db
      .update(s.refreshTokens)
      .set({ expiresAt: '2020-01-01T00:00:00Z' })
      .where(eq(s.refreshTokens.tokenHash, sha256(u.refreshToken)));
    const res = await t.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken, deviceId: u.device.id });
    expectError(res, 401, 'TOKEN_EXPIRED');
  });
});

describe('access tokens', () => {
  it('protects routes and rejects missing, malformed and tampered tokens', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    expectError(await t.http.get('/v1/me'), 401, 'UNAUTHENTICATED');
    expectError(await t.http.get('/v1/me').set(bearer('not.a.jwt')), 401, 'UNAUTHENTICATED');
    const [h, p, sig] = u.accessToken.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), ver: true }),
    ).toString('base64url');
    expectError(
      await t.http.get('/v1/me').set(bearer(`${h}.${forged}.${sig}`)),
      401,
      'UNAUTHENTICATED',
    );
    const ok = await t.http.get('/v1/me').set(bearer(u.accessToken));
    expectShape(UserDto, ok.body);
  });
});

describe('logout', () => {
  it('logout revokes this device family; logout-all revokes every device', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const tablet = device('Tablet');
    const second = await t.http
      .post('/v1/auth/login')
      .send({ email: u.email, password: STRONG_PASSWORD, device: tablet });

    await t.http
      .post('/v1/auth/logout')
      .set(bearer(u.accessToken))
      .send({ refreshToken: u.refreshToken })
      .expect(204);
    expect(
      (
        await t.http
          .post('/v1/auth/refresh')
          .send({ refreshToken: u.refreshToken, deviceId: u.device.id })
      ).status,
    ).toBe(401);
    expect(
      (
        await t.http
          .post('/v1/auth/refresh')
          .send({ refreshToken: second.body.refreshToken, deviceId: tablet.id })
      ).status,
    ).toBe(200);

    const third = await t.http
      .post('/v1/auth/login')
      .send({ email: u.email, password: STRONG_PASSWORD, device: tablet });
    await t.http.post('/v1/auth/logout-all').set(bearer(third.body.accessToken)).expect(204);
    expect(
      (
        await t.http
          .post('/v1/auth/refresh')
          .send({ refreshToken: third.body.refreshToken, deviceId: tablet.id })
      ).status,
    ).toBe(401);
  });

  it('answers 204 for an unknown refresh token', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    await t.http
      .post('/v1/auth/logout')
      .set(bearer(u.accessToken))
      .send({ refreshToken: 'x'.repeat(43) })
      .expect(204);
  });
});

describe('email verification', () => {
  it('verifies once; reuse is TOKEN_INVALID and expiry is 410', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    await t.drain();
    const token = t.mail.lastToken(u.email)!;

    expect((await t.http.post('/v1/auth/verify-email').send({ token })).body).toEqual({
      emailVerified: true,
    });
    expectError(await t.http.post('/v1/auth/verify-email').send({ token }), 400, 'TOKEN_INVALID');

    const me = await t.http.get('/v1/me').set(bearer(u.accessToken));
    expect(me.body.emailVerified).toBe(true);
    const refreshed = await t.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken, deviceId: u.device.id });
    const claims = JSON.parse(
      Buffer.from(refreshed.body.accessToken.split('.')[1], 'base64url').toString(),
    );
    expect(claims).toMatchObject({ sub: u.userId, dev: u.device.id, ver: true });

    const other = await registerUser(t);
    await t.drain();
    const stale = t.mail.lastToken(other.email)!;
    await pools.owner.db
      .update(s.emailTokens)
      .set({ expiresAt: '2020-01-01T00:00:00Z' })
      .where(eq(s.emailTokens.tokenHash, sha256(stale)));
    expectError(
      await t.http.post('/v1/auth/verify-email').send({ token: stale }),
      410,
      'TOKEN_EXPIRED',
    );
  });

  it('resend is limited to one per five minutes', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    await t.http.post('/v1/auth/resend-verification').set(bearer(u.accessToken)).expect(202);
    expectError(
      await t.http.post('/v1/auth/resend-verification').set(bearer(u.accessToken)),
      429,
      'RATE_LIMITED',
    );
  });
});

describe('password recovery and change', () => {
  it('forgot always answers 202; reset sets the password and ends every session', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    await t.drain();
    t.mail.outbox.length = 0;

    await t.http.post('/v1/auth/forgot-password').send({ email: uniqueEmail() }).expect(202);
    await t.drain();
    expect(t.mail.outbox).toHaveLength(0);

    await t.http.post('/v1/auth/forgot-password').send({ email: u.email }).expect(202);
    await t.drain();
    const token = t.mail.lastToken(u.email)!;
    expect(t.mail.outbox[0]!.text).toContain('https://app.nexus.example/reset?token=');

    const newPassword = 'lantern-orbit-velvet-meadow';
    await t.http.post('/v1/auth/reset-password').send({ token, password: newPassword }).expect(204);
    expectError(
      await t.http.post('/v1/auth/reset-password').send({ token, password: newPassword }),
      400,
      'TOKEN_INVALID',
    );
    expect(
      (
        await t.http
          .post('/v1/auth/refresh')
          .send({ refreshToken: u.refreshToken, deviceId: u.device.id })
      ).status,
    ).toBe(401);
    await t.http
      .post('/v1/auth/login')
      .send({ email: u.email, password: newPassword, device: u.device })
      .expect(200);
    await t.drain();
    expect(t.mail.outbox.at(-1)!.subject).toBe('Your NEXUS password was changed');
  });

  it('change-password checks the current password and issues a new family', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    expectError(
      await t.http
        .post('/v1/auth/change-password')
        .set(bearer(u.accessToken))
        .send({ currentPassword: 'wrong-password', newPassword: 'lantern-orbit-velvet-meadow' }),
      401,
      'INVALID_CREDENTIALS',
    );
    const res = await t.http
      .post('/v1/auth/change-password')
      .set(bearer(u.accessToken))
      .send({ currentPassword: STRONG_PASSWORD, newPassword: 'lantern-orbit-velvet-meadow' });
    const pair = expectShape(TokenPairDto, res.body);
    expect(
      (
        await t.http
          .post('/v1/auth/refresh')
          .send({ refreshToken: u.refreshToken, deviceId: u.device.id })
      ).status,
    ).toBe(401);
    expect(
      (
        await t.http
          .post('/v1/auth/refresh')
          .send({ refreshToken: pair.refreshToken, deviceId: u.device.id })
      ).status,
    ).toBe(200);
  });
});

describe('request hygiene', () => {
  it('sets no-store, refuses non-JSON bodies and validates input', async () => {
    const t = await makeApp(pools);
    const res = await t.http.post('/v1/auth/login').set('content-type', 'text/plain').send('hello');
    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(res.headers['cache-control']).toBe('no-store');
    const bad = await t.http.post('/v1/auth/login').send({ email: 'x' });
    expectError(bad, 400, 'VALIDATION_FAILED');
    expect(bad.body.error.details.map((d: { path: string[] }) => d.path[0])).toEqual(
      expect.arrayContaining(['email', 'password', 'device']),
    );
  });
});
