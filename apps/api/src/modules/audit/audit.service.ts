import type { AuditAction } from '@nexus/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { auditLogs } from '../../db/schema';
import type { Tx } from '../../db/withUser';

/** Where a request came from; recorded with security events. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface AuditEntry {
  userId: string;
  action: AuditAction;
  metadata?: Record<string, unknown>;
}

/**
 * Security audit log (TDD Section H, Audit logs). Never records note content,
 * titles, email bodies or secrets: metadata is ids and counts only.
 */
export class AuditService {
  /** Writes inside a user-scoped transaction (RLS context set). */
  async record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      userId: entry.userId,
      action: entry.action,
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 512) ?? null,
      metadata: entry.metadata ?? {},
    });
  }

  /**
   * Writes events that happen without a user context (failed login for an
   * unknown email, refresh-token reuse) through the `audit_write` function.
   */
  async recordWithoutContext(
    db: Db,
    ctx: RequestContext,
    entry: {
      userId: string | null;
      action: 'auth.login_failed' | 'auth.refresh_reuse';
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await db.execute(
      sql`SELECT audit_write(${entry.userId}::uuid, ${entry.action}, ${ctx.ip}::inet, ${ctx.userAgent}, ${JSON.stringify(entry.metadata ?? {})}::jsonb)`,
    );
  }
}
