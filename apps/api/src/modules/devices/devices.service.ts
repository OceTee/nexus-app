import type { DeviceDto, DeviceRegisterInput, DeviceUpdateInput } from '@nexus/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { devices } from '../../db/schema';
import { withUser } from '../../db/withUser';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../lib/errors';
import type { AuditService, RequestContext } from '../audit/audit.service';
import type { AuthRepo } from '../auth/auth.repo';

type DeviceRow = typeof devices.$inferSelect;

function toDto(row: DeviceRow, currentDeviceId: string): DeviceDto {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    appVersion: row.appVersion,
    lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    isCurrent: row.id === currentDeviceId,
    hasPush: row.pushToken !== null,
  };
}

/** `/v1/devices` (TDD Section F, Devices). Revoked devices are hidden. */
export class DevicesService {
  constructor(
    private readonly db: Db,
    private readonly repo: AuthRepo,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, currentDeviceId: string): Promise<{ items: DeviceDto[] }> {
    const rows = await withUser(this.db, userId, (tx) =>
      tx
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(asc(devices.createdAt)),
    );
    return { items: rows.map((r) => toDto(r, currentDeviceId)) };
  }

  /** Idempotent upsert of the calling device (name, version, push token). */
  async register(
    userId: string,
    currentDeviceId: string,
    input: DeviceRegisterInput,
  ): Promise<DeviceDto> {
    if (input.id !== currentDeviceId) throw new ForbiddenError();
    return withUser(this.db, userId, async (tx) => {
      await this.repo.upsertDevice(tx, userId, input);
      const [row] = await tx.select().from(devices).where(eq(devices.id, input.id));
      return toDto(row!, currentDeviceId);
    });
  }

  async update(
    userId: string,
    currentDeviceId: string,
    deviceId: string,
    input: DeviceUpdateInput,
  ): Promise<DeviceDto> {
    return withUser(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(devices)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.pushToken !== undefined ? { pushToken: input.pushToken } : {}),
        })
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
        .returning();
      if (!row) throw new NotFoundError('Device');
      return toDto(row, currentDeviceId);
    });
  }

  /** Revokes another device: its tokens die now and its next sync gets 403. */
  async revoke(
    userId: string,
    currentDeviceId: string,
    deviceId: string,
    ctx: RequestContext,
  ): Promise<void> {
    if (deviceId === currentDeviceId) {
      throw new BusinessRuleError('CANNOT_REVOKE_SELF', 'Use sign out on this device instead');
    }
    await withUser(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(devices)
        .set({ revokedAt: sql`now()`, pushToken: null })
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
        .returning({ id: devices.id });
      if (!row) throw new NotFoundError('Device');
      await this.repo.revokeAllForDevice(tx, userId, deviceId);
      await this.audit.record(tx, ctx, { userId, action: 'device.revoke', metadata: { deviceId } });
    });
  }
}
