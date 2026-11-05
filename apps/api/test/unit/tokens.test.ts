import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createAccessTokenSigner, randomToken, sha256 } from '../../src/lib/tokens';
import { assertNotDisposable, assertStrongPassword } from '../../src/modules/auth/passwordPolicy';

const current = { kid: 'k2', secret: 'current-secret-that-is-at-least-32-chars' };
const previous = { kid: 'k1', secret: 'previous-secret-that-is-at-least-32-chars' };
const claims = {
  userId: '6f1c2a3e-9b4d-4c2e-8f1a-2b3c4d5e6f70',
  deviceId: '019300a1-7d2e-7c3a-9f41-2a7b1c9e0d11',
  emailVerified: true,
};

describe('access tokens', () => {
  it('round-trips the claims with the current key', async () => {
    const signer = createAccessTokenSigner(current);
    const token = await signer.sign(claims);
    expect(await signer.verify(token)).toMatchObject({
      sub: claims.userId,
      dev: claims.deviceId,
      ver: true,
    });
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString());
    expect(header).toEqual({ alg: 'HS256', kid: 'k2', typ: 'JWT' });
  });

  it('accepts tokens signed with the previous key during rotation', async () => {
    const old = await createAccessTokenSigner(previous).sign(claims);
    await expect(createAccessTokenSigner(current, previous).verify(old)).resolves.toMatchObject({
      sub: claims.userId,
    });
    await expect(createAccessTokenSigner(current).verify(old)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('reports expiry as TOKEN_EXPIRED beyond the 60 s tolerance', async () => {
    const key = new TextEncoder().encode(current.secret);
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ dev: claims.deviceId, ver: false })
      .setProtectedHeader({ alg: 'HS256', kid: 'k2' })
      .setSubject(claims.userId)
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 120)
      .sign(key);
    await expect(createAccessTokenSigner(current).verify(expired)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('refuses unsigned and wrong-algorithm tokens (TM-12)', async () => {
    const signer = createAccessTokenSigner(current);
    const body = Buffer.from(
      JSON.stringify({ sub: claims.userId, dev: claims.deviceId, ver: true, exp: 9e9 }),
    ).toString('base64url');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'k2' })).toString('base64url')}.${body}.`;
    await expect(signer.verify(none)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const hs512 = await new SignJWT({ dev: claims.deviceId, ver: true })
      .setProtectedHeader({ alg: 'HS512', kid: 'k2' })
      .setSubject(claims.userId)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(current.secret));
    await expect(signer.verify(hs512)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('generates 256-bit random tokens and hashes them', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(randomToken());
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('password policy', () => {
  it('accepts long passphrases and refuses common or personal passwords', () => {
    expect(() => assertStrongPassword('correct-horse-battery-staple')).not.toThrow();
    expect(() => assertStrongPassword('password123')).toThrow();
    expect(() =>
      assertStrongPassword('amaraokafor', ['amaraokafor@example.com', 'Amara Okafor']),
    ).toThrow();
  });

  it('refuses disposable email domains', () => {
    expect(() => assertNotDisposable('a@mailinator.com')).toThrow();
    expect(() => assertNotDisposable('a@example.com')).not.toThrow();
  });
});
