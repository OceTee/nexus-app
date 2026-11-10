import type {
  AuthSessionDto,
  ChangePasswordInput,
  DeviceRegisterInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
  TokenPairDto,
} from '@nexus/shared';
import { v7 as uuidv7 } from 'uuid';
import {
  RATE_LIMITS,
  REFRESH_TOKEN_TTL_DAYS,
  RESET_TOKEN_TTL_MINUTES,
  VERIFY_TOKEN_TTL_HOURS,
} from '../../config/constants';
import type { Db } from '../../db/client';
import { withUser, type Tx } from '../../db/withUser';
import type { Limiters } from '../../http/middleware/rateLimit';
import { consume } from '../../http/middleware/rateLimit';
import {
  DuplicateError,
  InvalidCredentialsError,
  LockedError,
  TokenGoneError,
  TokenInvalidError,
  UnauthenticatedError,
} from '../../lib/errors';
import { randomToken, sha256, type AccessTokenSigner } from '../../lib/tokens';
import type { JobQueue } from '../../jobs/queue';
import type { AuditService, RequestContext } from '../audit/audit.service';
import type { AuthRepo } from './auth.repo';
import { hashPassword, needsRehash, verifyPassword } from './password';
import { assertNotDisposable, assertStrongPassword } from './passwordPolicy';
import { toUserDto } from './userDto';

export interface AuthServiceDeps {
  db: Db;
  repo: AuthRepo;
  audit: AuditService;
  signer: AccessTokenSigner;
  queue: JobQueue;
  limiters: Limiters;
  appUrl: string;
}

const addMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const DAY = 86_400_000;

/** A real Argon2id hash for timing equalisation when the email is unknown. */
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('nexus-timing-equaliser'));

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Authentication flows (TDD Sections D, F and H): register, login, refresh
 * with rotation and reuse detection, logout, verification and password reset.
 */
export class AuthService {
  constructor(private readonly d: AuthServiceDeps) {}

  // ---------------------------------------------------------------- register

  async register(input: RegisterInput, ctx: RequestContext): Promise<AuthSessionDto> {
    assertNotDisposable(input.email);
    assertStrongPassword(input.password, [input.email, input.displayName ?? '']);
    const passwordHash = await hashPassword(input.password);

    let created;
    try {
      created = await this.d.repo.createUser(
        this.d.db,
        input.email,
        passwordHash,
        input.displayName ?? '',
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateError('account', input.email);
      throw err;
    }

    const { session, verifyToken } = await withUser(this.d.db, created.id, async (tx) => {
      await this.d.repo.upsertDevice(tx, created.id, input.device);
      const verifyToken = await this.issueEmailToken(tx, created.id, 'verify');
      await this.d.audit.record(tx, ctx, {
        userId: created.id,
        action: 'auth.register',
        metadata: { deviceId: input.device.id },
      });
      const session = await this.issueSession(tx, created.id, input.device.id, ctx);
      return { session, verifyToken };
    });

    await this.d.queue.send('email.send', {
      template: 'verify-email',
      to: created.email,
      userId: created.id,
      vars: { url: this.link('verify', verifyToken) },
    });
    return session;
  }

  // ------------------------------------------------------------------- login

  async login(input: LoginInput, ctx: RequestContext): Promise<AuthSessionDto> {
    const lockKey = `email:${input.email}`;
    const failures = await this.d.limiters.loginFailures.get(lockKey);
    if (failures && failures.consumedPoints >= RATE_LIMITS.loginFailures.points) {
      throw new LockedError(Math.max(1, Math.ceil(failures.msBeforeNext / 1000)));
    }

    const user = await this.d.repo.findUserByEmail(this.d.db, input.email);
    const ok = user
      ? await verifyPassword(user.password_hash, input.password)
      : await verifyPassword(await getDummyHash(), `${input.password}\u0000no-user`).then(
          () => false,
        );

    if (!user || !ok) {
      await this.recordFailedLogin(lockKey, user?.id ?? null, ctx);
      throw new InvalidCredentialsError();
    }

    await this.d.limiters.loginFailures.delete(lockKey);

    const { session, isNew } = await withUser(this.d.db, user.id, async (tx) => {
      if (needsRehash(user.password_hash)) {
        await this.d.repo.updatePasswordHash(tx, user.id, await hashPassword(input.password));
      }
      const { isNew } = await this.d.repo.upsertDevice(tx, user.id, input.device);
      await this.d.audit.record(tx, ctx, {
        userId: user.id,
        action: 'auth.login',
        metadata: { deviceId: input.device.id, newDevice: isNew },
      });
      const session = await this.issueSession(tx, user.id, input.device.id, ctx);
      return { session, isNew };
    });

    if (isNew) await this.announceNewDevice(user.id, user.email, input.device);
    return session;
  }

  private async recordFailedLogin(lockKey: string, userId: string | null, ctx: RequestContext) {
    try {
      const r = await this.d.limiters.loginFailures.consume(lockKey);
      if (r.remainingPoints === 0) {
        // Fifth failure: lock for 15 minutes from now.
        await this.d.limiters.loginFailures.block(lockKey, RATE_LIMITS.loginFailures.lockSeconds);
      }
    } catch {
      // Already at the limit; the lock check on the next attempt handles it.
    }
    await this.d.audit.recordWithoutContext(this.d.db, ctx, {
      userId,
      action: 'auth.login_failed',
    });
  }

  private async announceNewDevice(userId: string, email: string, device: DeviceRegisterInput) {
    const vars = { deviceName: device.name, platform: device.platform };
    await this.d.queue.send('push.send', {
      userId,
      event: 'security.new-device',
      excludeDeviceId: device.id,
      vars,
    });
    await this.d.queue.send('email.send', { template: 'new-device', to: email, userId, vars });
  }

  // ----------------------------------------------------------------- refresh

  async refresh(input: RefreshInput, ctx: RequestContext): Promise<TokenPairDto> {
    const presented = await this.d.repo.findRefreshToken(this.d.db, sha256(input.refreshToken));
    if (!presented || presented.deviceId !== input.deviceId) throw new UnauthenticatedError();

    if (presented.revokedAt) {
      if (presented.replacedById) {
        // Reuse of a rotated-out token: assume theft and end the whole family.
        await this.d.repo.revokeFamily(this.d.db, presented.familyId);
        await this.d.audit.recordWithoutContext(this.d.db, ctx, {
          userId: presented.userId,
          action: 'auth.refresh_reuse',
          metadata: { deviceId: presented.deviceId, familyId: presented.familyId },
        });
        throw new UnauthenticatedError('TOKEN_REUSED');
      }
      throw new UnauthenticatedError();
    }
    if (Date.parse(presented.expiresAt) <= Date.now())
      throw new UnauthenticatedError('TOKEN_EXPIRED');

    const result = await withUser(this.d.db, presented.userId, async (tx) => {
      const user = await this.d.repo.getUser(tx, presented.userId);
      if (!user) throw new UnauthenticatedError();
      if (!(await this.d.repo.isDeviceActive(tx, user.id, presented.deviceId))) {
        throw new UnauthenticatedError();
      }
      const refreshToken = randomToken();
      const successor = await this.d.repo.insertRefreshToken(tx, {
        userId: user.id,
        deviceId: presented.deviceId,
        familyId: presented.familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: addMs(REFRESH_TOKEN_TTL_DAYS * DAY),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      const rotated = await this.d.repo.rotateRefreshToken(tx, presented.id, successor.id);
      if (!rotated) return null; // a concurrent refresh won the race
      const accessToken = await this.d.signer.sign({
        userId: user.id,
        deviceId: presented.deviceId,
        emailVerified: user.emailVerifiedAt !== null,
      });
      return { accessToken, refreshToken };
    });

    if (!result) {
      await this.d.repo.revokeFamily(this.d.db, presented.familyId);
      throw new UnauthenticatedError('TOKEN_REUSED');
    }
    return result;
  }

  // ------------------------------------------------------------------ logout

  /** Revokes the presented token's family if it belongs to the caller. Always succeeds. */
  async logout(userId: string, refreshToken: string): Promise<void> {
    const row = await this.d.repo.findRefreshToken(this.d.db, sha256(refreshToken));
    if (row && row.userId === userId) await this.d.repo.revokeFamily(this.d.db, row.familyId);
  }

  async logoutAll(userId: string, ctx: RequestContext): Promise<void> {
    await withUser(this.d.db, userId, async (tx) => {
      await this.d.repo.revokeAllForUser(tx, userId);
      await this.d.audit.record(tx, ctx, { userId, action: 'auth.logout_all' });
    });
  }

  // ------------------------------------------------------------ verification

  async verifyEmail(token: string, ctx: RequestContext): Promise<void> {
    const row = await this.d.repo.findEmailToken(this.d.db, 'verify', sha256(token));
    if (!row || row.usedAt) throw new TokenInvalidError();
    if (Date.parse(row.expiresAt) <= Date.now()) throw new TokenGoneError();
    await withUser(this.d.db, row.userId, async (tx) => {
      if (!(await this.d.repo.consumeEmailToken(tx, row.id))) throw new TokenInvalidError();
      await this.d.repo.markEmailVerified(tx, row.userId);
      await this.d.audit.record(tx, ctx, { userId: row.userId, action: 'auth.email_verified' });
    });
  }

  async resendVerification(userId: string): Promise<void> {
    await consume(this.d.limiters.resendVerification, `user:${userId}`);
    const sent = await withUser(this.d.db, userId, async (tx) => {
      const user = await this.d.repo.getUser(tx, userId);
      if (!user || user.emailVerifiedAt) return null;
      return { email: user.email, token: await this.issueEmailToken(tx, userId, 'verify') };
    });
    if (sent) {
      await this.d.queue.send('email.send', {
        template: 'verify-email',
        to: sent.email,
        userId,
        vars: { url: this.link('verify', sent.token) },
      });
    }
  }

  // --------------------------------------------------------- password reset

  /** Always resolves the same way whether or not the account exists. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.d.repo.findUserByEmail(this.d.db, email);
    if (!user) return;
    const token = await withUser(this.d.db, user.id, (tx) =>
      this.issueEmailToken(tx, user.id, 'reset'),
    );
    await this.d.queue.send('email.send', {
      template: 'reset-password',
      to: user.email,
      userId: user.id,
      vars: { url: this.link('reset', token) },
    });
  }

  async resetPassword(input: ResetPasswordInput, ctx: RequestContext): Promise<void> {
    const row = await this.d.repo.findEmailToken(this.d.db, 'reset', sha256(input.token));
    if (!row || row.usedAt) throw new TokenInvalidError();
    if (Date.parse(row.expiresAt) <= Date.now()) throw new TokenGoneError();

    const email = await withUser(this.d.db, row.userId, async (tx) => {
      const user = await this.d.repo.getUser(tx, row.userId);
      if (!user) throw new TokenInvalidError();
      assertStrongPassword(input.password, [user.email, user.displayName]);
      if (!(await this.d.repo.consumeEmailToken(tx, row.id))) throw new TokenInvalidError();
      await this.d.repo.updatePasswordHash(tx, user.id, await hashPassword(input.password));
      await this.d.repo.revokeAllForUser(tx, user.id);
      await this.d.audit.record(tx, ctx, { userId: user.id, action: 'auth.password_reset' });
      return user.email;
    });
    await this.d.limiters.loginFailures.delete(`email:${email}`);
    await this.d.queue.send('email.send', {
      template: 'password-changed',
      to: email,
      userId: row.userId,
      vars: {},
    });
  }

  async changePassword(
    userId: string,
    deviceId: string,
    input: ChangePasswordInput,
    ctx: RequestContext,
  ): Promise<TokenPairDto> {
    const result = await withUser(this.d.db, userId, async (tx) => {
      const user = await this.d.repo.getUser(tx, userId);
      if (!user) throw new UnauthenticatedError();
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new InvalidCredentialsError();
      }
      assertStrongPassword(input.newPassword, [user.email, user.displayName]);
      await this.d.repo.updatePasswordHash(tx, userId, await hashPassword(input.newPassword));
      await this.d.repo.revokeAllForUser(tx, userId);
      await this.d.audit.record(tx, ctx, {
        userId,
        action: 'auth.password_changed',
        metadata: { deviceId },
      });
      const session = await this.issueSession(tx, userId, deviceId, ctx);
      return {
        email: user.email,
        pair: { accessToken: session.accessToken, refreshToken: session.refreshToken },
      };
    });
    await this.d.queue.send('email.send', {
      template: 'password-changed',
      to: result.email,
      userId,
      vars: {},
    });
    return result.pair;
  }

  // ----------------------------------------------------------------- helpers

  /** New refresh-token family for a device, plus an access token. */
  private async issueSession(
    tx: Tx,
    userId: string,
    deviceId: string,
    ctx: RequestContext,
  ): Promise<AuthSessionDto> {
    const user = await this.d.repo.getUser(tx, userId);
    if (!user) throw new UnauthenticatedError();
    const refreshToken = randomToken();
    await this.d.repo.insertRefreshToken(tx, {
      userId,
      deviceId,
      familyId: uuidv7(),
      tokenHash: sha256(refreshToken),
      expiresAt: addMs(REFRESH_TOKEN_TTL_DAYS * DAY),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    const accessToken = await this.d.signer.sign({
      userId,
      deviceId,
      emailVerified: user.emailVerifiedAt !== null,
    });
    return { user: toUserDto(user), accessToken, refreshToken, deviceId };
  }

  private async issueEmailToken(
    tx: Tx,
    userId: string,
    purpose: 'verify' | 'reset',
  ): Promise<string> {
    const token = randomToken();
    const ttl =
      purpose === 'verify' ? VERIFY_TOKEN_TTL_HOURS * 3_600_000 : RESET_TOKEN_TTL_MINUTES * 60_000;
    await this.d.repo.insertEmailToken(tx, {
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: addMs(ttl),
    });
    return token;
  }

  private link(path: 'verify' | 'reset', token: string): string {
    return emailLink(this.d.appUrl, path, token);
  }
}

/**
 * The link in verification and reset emails: APP_URL + path + token. Joined
 * relative to APP_URL so a site under a path (GitHub Pages serves
 * https://user.github.io/repo) keeps it.
 */
export function emailLink(appUrl: string, path: 'verify' | 'reset', token: string): string {
  const url = new URL(path, appUrl.endsWith('/') ? appUrl : `${appUrl}/`);
  url.searchParams.set('token', token);
  return url.toString();
}
