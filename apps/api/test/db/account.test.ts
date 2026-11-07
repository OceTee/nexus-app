import {
  AuditEventDto,
  DeletionStatusDto,
  DeviceDto,
  DeviceListDto,
  Paginated,
  UsageDto,
  UserDto,
} from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  type Pools,
} from '../helpers/testApp';

let pools: Pools;
beforeAll(() => {
  pools = openPools();
});
afterAll(() => closePools(pools));

describe('/v1/me', () => {
  // Found by the ZAP scan: Postgres refuses NUL in text, which used to be a 500.
  it('rejects text Postgres cannot store with 400, not 500', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    expectError(
      await t.http
        .patch('/v1/me')
        .set(bearer(u.accessToken))
        .send({ displayName: 'Nul\u0000name' }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('returns and updates the profile, merging settings', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const me = expectShape(UserDto, (await t.http.get('/v1/me').set(bearer(u.accessToken))).body);
    expect(me.settings).toEqual({ telemetryOptIn: false, push: { newDeviceSignIn: true } });

    const updated = await t.http
      .patch('/v1/me')
      .set(bearer(u.accessToken))
      .send({ displayName: 'Amara O.', settings: { push: { newDeviceSignIn: false } } });
    expect(expectShape(UserDto, updated.body)).toMatchObject({
      displayName: 'Amara O.',
      settings: { telemetryOptIn: false, push: { newDeviceSignIn: false } },
    });
    expectError(
      await t.http.patch('/v1/me').set(bearer(u.accessToken)).send({}),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('reports usage with the quota', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const usage = expectShape(
      UsageDto,
      (await t.http.get('/v1/me/usage').set(bearer(u.accessToken))).body,
    );
    expect(usage).toEqual({
      notes: 0,
      collections: 0,
      tags: 0,
      attachments: 0,
      attachmentBytes: 0,
      versions: 0,
      quotaBytes: 1_073_741_824,
    });
  });

  it('requests deletion with the password, then cancels it', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    expectError(
      await t.http
        .post('/v1/me/deletion')
        .set(bearer(u.accessToken))
        .send({ password: 'wrong-one' }),
      401,
      'INVALID_CREDENTIALS',
    );
    const res = await t.http
      .post('/v1/me/deletion')
      .set(bearer(u.accessToken))
      .send({ password: STRONG_PASSWORD });
    const status = expectShape(DeletionStatusDto, res.body);
    expect(Date.parse(status.purgeAt) - Date.parse(status.deletionRequestedAt)).toBe(
      30 * 86_400_000,
    );
    await t.drain();
    expect(t.mail.outbox.at(-1)!.subject).toBe('Your NEXUS account will be deleted');

    const me = await t.http.get('/v1/me').set(bearer(u.accessToken));
    expect(me.body.deletionRequestedAt).toBe(status.deletionRequestedAt);

    await t.http.delete('/v1/me/deletion').set(bearer(u.accessToken)).expect(204);
    expectError(
      await t.http.delete('/v1/me/deletion').set(bearer(u.accessToken)),
      404,
      'NOT_FOUND',
    );
    expect(
      (await t.http.get('/v1/me').set(bearer(u.accessToken))).body.deletionRequestedAt,
    ).toBeNull();
  });

  it('lists security events newest first with keyset pagination', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    for (let i = 0; i < 3; i++) {
      await t.http
        .post('/v1/auth/login')
        .send({ email: u.email, password: STRONG_PASSWORD, device: u.device })
        .expect(200);
    }
    const page1 = await t.http.get('/v1/me/audit?limit=2').set(bearer(u.accessToken));
    const first = expectShape(Paginated(AuditEventDto), page1.body);
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.items[0]).toMatchObject({ action: 'auth.login', deviceName: 'Pixel 7' });

    const page2 = await t.http
      .get(`/v1/me/audit?limit=10&cursor=${first.nextCursor}`)
      .set(bearer(u.accessToken));
    const second = expectShape(Paginated(AuditEventDto), page2.body);
    expect(second.items.map((e) => e.action)).toEqual(['auth.login', 'auth.register']);
    expect(second.hasMore).toBe(false);
    expect(Number(second.items[0]!.id)).toBeLessThan(Number(first.items[1]!.id));

    expectError(
      await t.http.get('/v1/me/audit?cursor=bogus').set(bearer(u.accessToken)),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('/v1/devices', () => {
  it('lists devices, renames, refuses self-revoke and revokes another device', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const tablet = device('Tablet');
    const other = await t.http
      .post('/v1/auth/login')
      .send({ email: u.email, password: STRONG_PASSWORD, device: tablet });

    const list = expectShape(
      DeviceListDto,
      (await t.http.get('/v1/devices').set(bearer(u.accessToken))).body,
    );
    expect(list.items.map((d) => [d.name, d.isCurrent])).toEqual([
      ['Pixel 7', true],
      ['Tablet', false],
    ]);

    const renamed = await t.http
      .patch(`/v1/devices/${tablet.id}`)
      .set(bearer(u.accessToken))
      .send({ name: 'Old tablet' });
    expect(expectShape(DeviceDto, renamed.body).name).toBe('Old tablet');

    expectError(
      await t.http.delete(`/v1/devices/${u.device.id}`).set(bearer(u.accessToken)),
      422,
      'CANNOT_REVOKE_SELF',
    );

    await t.http.delete(`/v1/devices/${tablet.id}`).set(bearer(u.accessToken)).expect(204);
    expect(
      (
        await t.http
          .post('/v1/auth/refresh')
          .send({ refreshToken: other.body.refreshToken, deviceId: tablet.id })
      ).status,
    ).toBe(401);
    const after = await t.http.get('/v1/devices').set(bearer(u.accessToken));
    expect(after.body.items).toHaveLength(1);
    expectError(
      await t.http.delete(`/v1/devices/${tablet.id}`).set(bearer(u.accessToken)),
      404,
      'NOT_FOUND',
    );
  });

  it('registers push tokens only for the calling device', async () => {
    const t = await makeApp(pools);
    const u = await registerUser(t);
    const res = await t.http
      .post('/v1/devices')
      .set(bearer(u.accessToken))
      .send({ ...u.device, pushToken: 'ExponentPushToken[abc]' });
    expect(expectShape(DeviceDto, res.body)).toMatchObject({ isCurrent: true, hasPush: true });
    expectError(
      await t.http.post('/v1/devices').set(bearer(u.accessToken)).send(device()),
      403,
      'FORBIDDEN',
    );
  });

  it('never shows one user another user’s devices', async () => {
    const t = await makeApp(pools);
    const a = await registerUser(t);
    const b = await registerUser(t);
    expectError(
      await t.http
        .patch(`/v1/devices/${b.device.id}`)
        .set(bearer(a.accessToken))
        .send({ name: 'x' }),
      404,
      'NOT_FOUND',
    );
    const list = await t.http.get('/v1/devices').set(bearer(a.accessToken));
    expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([a.device.id]);
  });
});
