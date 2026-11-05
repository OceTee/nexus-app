import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { devices, emailTokens, refreshTokens, users } from '../../db/schema';
import type { Tx } from '../../db/withUser';

/** User row as returned by the SECURITY DEFINER lookups. */
export interface AuthUserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  email_verified_at: string | null;
  settings: unknown;
  deletion_requested_at: string | null;
  created_at: string;
}

type RefreshRow = typeof refreshTokens.$inferSelect;
type EmailTokenRow = typeof emailTokens.$inferSelect;

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

function normaliseUserRow(row: Record<string, unknown>): AuthUserRow {
  return {
    ...(row as unknown as AuthUserRow),
    email_verified_at: iso(row.email_verified_at),
    deletion_requested_at: iso(row.deletion_requested_at),
    created_at: iso(row.created_at)!,
  };
}

export class AuthRepo {
  /** Looks up a user by email before any user context exists. */
  async findUserByEmail(db: Db, email: string): Promise<AuthUserRow | null> {
    const result = await db.execute(sql`SELECT * FROM auth_find_user_by_email(${email})`);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? normaliseUserRow(row) : null;
  }

  /** Creates a user before any user context exists. Throws pg 23505 on duplicate email. */
  async createUser(db: Db, email: string, passwordHash: string, displayName: string) {
    const result = await db.execute(
      sql`SELECT * FROM auth_create_user(${email}, ${passwordHash}, ${displayName})`,
    );
    return normaliseUserRow(result.rows[0] as Record<string, unknown>);
  }

  async getUser(tx: Tx, userId: string) {
    const [row] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    return row ?? null;
  }

  async updatePasswordHash(tx: Tx, userId: string, passwordHash: string): Promise<void> {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  async markEmailVerified(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
      .where(eq(users.id, userId));
  }

  /**
   * Registers or refreshes a device for this user. Returns whether it is new
   * to the account. A revoked device signing in again is reactivated.
   */
  async upsertDevice(
    tx: Tx,
    userId: string,
    device: {
      id: string;
      name: string;
      platform: 'ios' | 'android';
      appVersion: string;
      pushToken?: string | undefined;
    },
  ): Promise<{ isNew: boolean }> {
    const [existing] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, device.id), eq(devices.userId, userId)));
    await tx
      .insert(devices)
      .values({ ...device, userId, pushToken: device.pushToken ?? null })
      .onConflictDoUpdate({
        target: devices.id,
        set: {
          name: device.name,
          platform: device.platform,
          appVersion: device.appVersion,
          ...(device.pushToken !== undefined ? { pushToken: device.pushToken } : {}),
          lastSeenAt: sql`now()`,
          revokedAt: null,
        },
      });
    return { isNew: !existing };
  }

  async isDeviceActive(tx: Tx, userId: string, deviceId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)));
    return Boolean(row);
  }

  async otherDevicesWithPush(tx: Tx, userId: string, deviceId: string): Promise<number> {
    const result = await tx.execute(
      sql`SELECT count(*)::int AS n FROM devices
          WHERE user_id = ${userId} AND id <> ${deviceId} AND revoked_at IS NULL`,
    );
    return (result.rows[0] as { n: number }).n;
  }

  // ----- refresh tokens (no RLS: looked up by hash before a user context) -----

  async insertRefreshToken(
    db: Db | Tx,
    row: {
      userId: string;
      deviceId: string;
      familyId: string;
      tokenHash: string;
      expiresAt: string;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<RefreshRow> {
    const [inserted] = await db.insert(refreshTokens).values(row).returning();
    return inserted!;
  }

  async findRefreshToken(db: Db | Tx, tokenHash: string): Promise<RefreshRow | null> {
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return row ?? null;
  }

  /** Revokes `id` and links it to its successor; false if it was already revoked (race). */
  async rotateRefreshToken(db: Db | Tx, id: string, successorId: string): Promise<boolean> {
    const updated = await db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()`, replacedById: successorId, lastUsedAt: sql`now()` })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return updated.length === 1;
  }

  async revokeFamily(db: Db | Tx, familyId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(db: Db | Tx, userId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForDevice(db: Db | Tx, userId: string, deviceId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          eq(refreshTokens.deviceId, deviceId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  // ----- email tokens (no RLS: looked up by hash from an emailed link) -----

  async insertEmailToken(
    db: Db | Tx,
    row: { userId: string; purpose: 'verify' | 'reset'; tokenHash: string; expiresAt: string },
  ): Promise<void> {
    await db.insert(emailTokens).values(row);
  }

  async findEmailToken(
    db: Db | Tx,
    purpose: 'verify' | 'reset',
    tokenHash: string,
  ): Promise<EmailTokenRow | null> {
    const [row] = await db
      .select()
      .from(emailTokens)
      .where(and(eq(emailTokens.tokenHash, tokenHash), eq(emailTokens.purpose, purpose)));
    return row ?? null;
  }

  /** Marks a token used; false if it was already used (single use, race-safe). */
  async consumeEmailToken(db: Db | Tx, id: string): Promise<boolean> {
    const updated = await db
      .update(emailTokens)
      .set({ usedAt: sql`now()` })
      .where(and(eq(emailTokens.id, id), isNull(emailTokens.usedAt)))
      .returning({ id: emailTokens.id });
    return updated.length === 1;
  }
}
