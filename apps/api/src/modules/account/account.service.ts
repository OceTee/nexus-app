import {
  LIMITS,
  decodeCursor,
  encodeCursor,
  type AuditEventDto,
  type DeletionStatusDto,
  type Paginated,
  type UpdateMeInput,
  type UsageDto,
  type UserDto,
} from '@nexus/shared';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DELETION_GRACE_DAYS } from '../../config/constants';
import type { Db } from '../../db/client';
import { auditLogs, devices, users } from '../../db/schema';
import { withUser } from '../../db/withUser';
import {
  InvalidCredentialsError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../lib/errors';
import type { JobQueue } from '../../jobs/queue';
import type { AuditService, RequestContext } from '../audit/audit.service';
import { verifyPassword } from '../auth/password';
import { toUserDto } from '../auth/userDto';

/** Sort key of the audit list: ids only increase, so newest first is id descending. */
const AuditCursor = z.object({ id: z.number().int().positive() });

const purgeDate = (requestedAt: string) =>
  new Date(Date.parse(requestedAt) + DELETION_GRACE_DAYS * 86_400_000).toISOString();

/** `/v1/me/*` (TDD Section F, Account). */
export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly queue: JobQueue,
  ) {}

  async me(userId: string): Promise<UserDto> {
    return withUser(this.db, userId, async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, userId));
      if (!row) throw new UnauthenticatedError();
      return toUserDto(row);
    });
  }

  async update(userId: string, input: UpdateMeInput): Promise<UserDto> {
    return withUser(this.db, userId, async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, userId));
      if (!row) throw new UnauthenticatedError();
      const current = toUserDto(row).settings;
      const settings = input.settings
        ? {
            ...current,
            ...(input.settings.telemetryOptIn !== undefined
              ? { telemetryOptIn: input.settings.telemetryOptIn }
              : {}),
            push: { ...current.push, ...input.settings.push },
          }
        : current;
      const [updated] = await tx
        .update(users)
        .set({
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          settings,
        })
        .where(eq(users.id, userId))
        .returning();
      return toUserDto(updated!);
    });
  }

  async usage(userId: string): Promise<UsageDto> {
    return withUser(this.db, userId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT
          (SELECT count(*) FROM notes WHERE deleted_at IS NULL)::int AS notes,
          (SELECT count(*) FROM collections WHERE deleted_at IS NULL)::int AS collections,
          (SELECT count(*) FROM tags WHERE deleted_at IS NULL)::int AS tags,
          (SELECT count(*) FROM attachments WHERE status = 'uploaded' AND deleted_at IS NULL)::int AS attachments,
          (SELECT coalesce(sum(size_bytes), 0) FROM attachments
             WHERE status = 'uploaded' AND deleted_at IS NULL)::bigint AS attachment_bytes,
          (SELECT count(*) FROM note_versions)::int AS versions`);
      const r = result.rows[0] as Record<string, number | string>;
      return {
        notes: Number(r.notes),
        collections: Number(r.collections),
        tags: Number(r.tags),
        attachments: Number(r.attachments),
        attachmentBytes: Number(r.attachment_bytes),
        versions: Number(r.versions),
        quotaBytes: LIMITS.attachmentQuotaBytes,
      };
    });
  }

  async requestDeletion(
    userId: string,
    password: string,
    ctx: RequestContext,
  ): Promise<DeletionStatusDto> {
    const result = await withUser(this.db, userId, async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, userId));
      if (!row) throw new UnauthenticatedError();
      if (!(await verifyPassword(row.passwordHash, password))) throw new InvalidCredentialsError();
      const [updated] = await tx
        .update(users)
        .set({ deletionRequestedAt: sql`coalesce(${users.deletionRequestedAt}, now())` })
        .where(eq(users.id, userId))
        .returning({ requestedAt: users.deletionRequestedAt, email: users.email });
      const requestedAt = new Date(updated!.requestedAt!).toISOString();
      await this.audit.record(tx, ctx, { userId, action: 'account.deletion_requested' });
      return {
        email: updated!.email,
        status: { deletionRequestedAt: requestedAt, purgeAt: purgeDate(requestedAt) },
      };
    });
    await this.queue.send('email.send', {
      template: 'deletion-requested',
      to: result.email,
      userId,
      vars: { purgeDate: result.status.purgeAt.slice(0, 10) },
    });
    return result.status;
  }

  async cancelDeletion(userId: string, ctx: RequestContext): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      const updated = await tx
        .update(users)
        .set({ deletionRequestedAt: null })
        .where(and(eq(users.id, userId), sql`${users.deletionRequestedAt} IS NOT NULL`))
        .returning({ id: users.id });
      if (updated.length === 0) throw new NotFoundError('Deletion request');
      await this.audit.record(tx, ctx, { userId, action: 'account.deletion_cancelled' });
    });
  }

  /** Recent security events, newest first, keyset-paginated. */
  async auditEvents(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Paginated<AuditEventDto>> {
    let after: z.infer<typeof AuditCursor> | undefined;
    if (cursor) {
      try {
        after = decodeCursor(cursor, AuditCursor);
      } catch {
        throw new ValidationError([
          { path: ['cursor'], issue: 'invalid_cursor', message: 'Invalid cursor' },
        ]);
      }
    }
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          ip: auditLogs.ip,
          createdAt: auditLogs.createdAt,
          deviceName: devices.name,
        })
        .from(auditLogs)
        .leftJoin(devices, sql`${devices.id}::text = ${auditLogs.metadata} ->> 'deviceId'`)
        .where(and(eq(auditLogs.userId, userId), after ? lt(auditLogs.id, after.id) : undefined))
        .orderBy(desc(auditLogs.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => ({
          id: String(r.id),
          action: r.action as AuditEventDto['action'],
          deviceName: r.deviceName ?? null,
          ip: r.ip ?? null,
          createdAt: new Date(r.createdAt).toISOString(),
        })),
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit && last ? encodeCursor({ id: last.id }) : null,
      };
    });
  }
}
