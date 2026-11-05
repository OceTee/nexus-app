import { createHash, randomBytes } from 'node:crypto';
import { AccessTokenClaims } from '@nexus/shared';
import { errors as joseErrors, jwtVerify, SignJWT, decodeProtectedHeader } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS, JWT_CLOCK_TOLERANCE_SECONDS } from '../config/constants';
import { UnauthenticatedError } from './errors';

/** 32 random bytes as base64url: refresh tokens and email tokens. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest; tokens are stored only as hashes. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface SigningKey {
  kid: string;
  secret: string;
}

export interface AccessTokenInput {
  userId: string;
  deviceId: string;
  emailVerified: boolean;
}

export interface AccessTokenSigner {
  sign(input: AccessTokenInput): Promise<string>;
  verify(token: string): Promise<AccessTokenClaims>;
}

/**
 * HS256 access tokens (TDD Section F, Authentication): claims
 * `{ sub, dev, ver, iat, exp }`, `kid` header for rotation, 15-minute lifetime,
 * 60-second clock tolerance. The algorithm is fixed; the token's `alg` is not
 * trusted (threat TM-12).
 */
export function createAccessTokenSigner(
  current: SigningKey,
  previous?: SigningKey,
): AccessTokenSigner {
  const keys = new Map<string, Uint8Array>([
    [current.kid, new TextEncoder().encode(current.secret)],
  ]);
  if (previous) keys.set(previous.kid, new TextEncoder().encode(previous.secret));
  const currentKey = keys.get(current.kid)!;

  return {
    async sign({ userId, deviceId, emailVerified }) {
      return new SignJWT({ dev: deviceId, ver: emailVerified })
        .setProtectedHeader({ alg: 'HS256', kid: current.kid, typ: 'JWT' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(currentKey);
    },

    async verify(token) {
      let kid: string | undefined;
      try {
        kid = decodeProtectedHeader(token).kid;
      } catch {
        throw new UnauthenticatedError();
      }
      const key = kid ? keys.get(kid) : undefined;
      if (!key) throw new UnauthenticatedError();
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
        });
        const claims = AccessTokenClaims.safeParse(payload);
        if (!claims.success) throw new UnauthenticatedError();
        return claims.data;
      } catch (err) {
        if (err instanceof joseErrors.JWTExpired) throw new UnauthenticatedError('TOKEN_EXPIRED');
        throw new UnauthenticatedError();
      }
    },
  };
}
