// Scheduled maintenance (TDD Section F, Background jobs; Section E, Data
// retention policy). These run across all users, so they use the maintenance
// connection (nexus_maint with BYPASSRLS, or the owner locally). Every job is
// idempotent: running it twice deletes nothing extra.

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Encrypter } from 'age-encryption';
import type { Logger } from 'pino';
import { DELETION_GRACE_DAYS } from '../config/constants';
import type { Db } from '../db/client';
import { auditLogs, syncStateServer } from '../db/schema';
import type { Storage } from '../integrations/r2';
import type { JobQueue } from './queue';
import { pruneVersions } from './versionsPrune';

export const CHANGE_FEED_DAYS = 90;
export const TRASH_DAYS = 30;
export const PENDING_ATTACHMENT_HOURS = 24;
export const TOMBSTONE_DAYS = 90;
export const TOKEN_GRACE_DAYS = 7;
export const RECEIPT_DAYS = 30;
export const AUDIT_DAYS = 365;
export const BACKUP_KEEP_DAYS = 30;
export const REMINDER_DAY = 23;

export interface MaintenanceDeps {
  /** Cross-user connection (BYPASSRLS). */
  db: Db;
  storage: Storage;
  queue: JobQueue;
  logger: Logger;
  /** Produces a pg_dump (custom format) of the database. */
  dumpDatabase?: () => Promise<Uint8Array>;
  /** age public key for backup encryption. */
  backupRecipient?: string;
}

const ago = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

/** `changes.compact` (weekly): drop feed rows older than 90 days and raise the horizon. */
export async function compactChanges(d: MaintenanceDeps, now = new Date()): Promise<number> {
  return d.db.transaction(async (tx) => {
    const deleted = rows<{ seq: string }>(
      await tx.execute(
        sql`DELETE FROM changes WHERE created_at < ${ago(now, CHANGE_FEED_DAYS)} RETURNING change_seq AS seq`,
      ),
    );
    if (deleted.length > 0) {
      const maxDeleted = Math.max(...deleted.map((r) => Number(r.seq)));
      await tx.update(syncStateServer).set({
        horizonSeq: sql`greatest(${syncStateServer.horizonSeq}, ${maxDeleted})`,
        compactedAt: sql`now()`,
      });
    }
    return deleted.length;
  });
}

/** `attachments.orphan-sweep` (daily): stale pending uploads, deleted objects, old tombstones. */
export async function sweepAttachments(d: MaintenanceDeps, now = new Date()) {
  const stale = rows<{ id: string; storage_key: string }>(
    await d.db.execute(sql`SELECT id, storage_key FROM attachments
      WHERE status = 'pending' AND created_at < ${new Date(now.getTime() - PENDING_ATTACHMENT_HOURS * 3_600_000).toISOString()}`),
  );
  for (const a of stale) {
    await d.storage.delete(a.storage_key);
    await d.db.execute(sql`DELETE FROM attachments WHERE id = ${a.id} AND status = 'pending'`);
  }
  const removed = rows<{ id: string; storage_key: string }>(
    await d.db.execute(sql`SELECT id, storage_key FROM attachments WHERE status = 'deleted'`),
  );
  for (const a of removed) await d.storage.delete(a.storage_key); // idempotent on S3
  const tombstones = await d.db.execute(
    sql`DELETE FROM attachments WHERE status = 'deleted' AND deleted_at < ${ago(now, TOMBSTONE_DAYS)}`,
  );
  return {
    stalePending: stale.length,
    objectsRemoved: removed.length,
    tombstonesDropped: tombstones.rowCount ?? 0,
  };
}

/**
 * `accounts.purge` (daily): notes in Trash for 30 days, then accounts whose
 * deletion grace period has passed (R2 prefix, then the user row, which
 * cascades to every table), each followed by a final email and audit row.
 */
export async function purgeAccounts(d: MaintenanceDeps, now = new Date()) {
  // 1. Trash older than 30 days: attachments first (their objects), then the notes.
  const trashed = rows<{ id: string; user_id: string; server_rev: number }>(
    await d.db.execute(sql`SELECT id, user_id, server_rev FROM notes
      WHERE deleted_at IS NOT NULL AND deleted_at < ${ago(now, TRASH_DAYS)}`),
  );
  for (const n of trashed) {
    const files = rows<{ storage_key: string }>(
      await d.db.execute(sql`SELECT storage_key FROM attachments WHERE note_id = ${n.id}`),
    );
    for (const f of files) await d.storage.delete(f.storage_key);
    await d.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM attachments WHERE note_id = ${n.id}`);
      await tx.execute(sql`DELETE FROM notes WHERE id = ${n.id}`);
      // Devices remove the note on their next sync.
      await tx.execute(sql`INSERT INTO changes (user_id, entity_type, entity_id, entity_key, op, rev)
        VALUES (${n.user_id}, 'note', ${n.id}, ${n.id}, 'delete', ${n.server_rev + 1})`);
    });
  }

  // 2. Accounts past the grace period.
  const due = rows<{ id: string; email: string }>(
    await d.db.execute(sql`SELECT id, email::text FROM users
      WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at < ${ago(now, DELETION_GRACE_DAYS)}`),
  );
  for (const u of due) {
    await d.storage.deletePrefix(`u/${u.id}/`);
    await d.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
      await tx.insert(auditLogs).values({
        userId: null,
        action: 'account.purged',
        metadata: { userHash: createHash('sha256').update(u.id).digest('hex').slice(0, 12) },
      });
    });
    await d.queue.send('email.send', { template: 'account-deleted', to: u.email, vars: {} });
    d.logger.info(
      { userHash: createHash('sha256').update(u.id).digest('hex').slice(0, 12) },
      'account purged',
    );
  }
  return { notesPurged: trashed.length, accountsPurged: due.length };
}

/** `account.deletion-reminder` (daily 09:00): email and push on day 23 of the grace period. */
export async function remindPendingDeletions(d: MaintenanceDeps, now = new Date()) {
  const users = rows<{ id: string; email: string; deletion_requested_at: string }>(
    await d.db.execute(sql`SELECT id, email::text, deletion_requested_at FROM users
      WHERE deletion_requested_at <= ${ago(now, REMINDER_DAY)}
        AND deletion_requested_at > ${ago(now, REMINDER_DAY + 1)}`),
  );
  for (const u of users) {
    const purgeDate = new Date(
      Date.parse(u.deletion_requested_at) + DELETION_GRACE_DAYS * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    await d.queue.send('email.send', {
      template: 'deletion-reminder',
      to: u.email,
      userId: u.id,
      vars: { purgeDate },
    });
    await d.queue.send('push.send', {
      userId: u.id,
      event: 'account.deletion-reminder',
      vars: { purgeDate },
    });
  }
  return users.length;
}

/** `tokens.prune` (daily): expired or revoked tokens after 7 days, receipts after 30. */
export async function pruneTokens(d: MaintenanceDeps, now = new Date()) {
  const cutoff = ago(now, TOKEN_GRACE_DAYS);
  // Successors first so replaced_by_id references never block a delete.
  const refresh = await d.db.execute(sql`DELETE FROM refresh_tokens
    WHERE expires_at < ${cutoff} OR (revoked_at IS NOT NULL AND revoked_at < ${cutoff})`);
  const email = await d.db.execute(sql`DELETE FROM email_tokens WHERE expires_at < ${cutoff}`);
  const receipts = await d.db.execute(
    sql`DELETE FROM op_receipts WHERE created_at < ${ago(now, RECEIPT_DAYS)}`,
  );
  return {
    refresh: refresh.rowCount ?? 0,
    email: email.rowCount ?? 0,
    receipts: receipts.rowCount ?? 0,
  };
}

/** `audit.prune` (monthly): audit rows older than 365 days. */
export async function pruneAudit(d: MaintenanceDeps, now = new Date()): Promise<number> {
  return (
    (await d.db.execute(sql`DELETE FROM audit_logs WHERE created_at < ${ago(now, AUDIT_DAYS)}`))
      .rowCount ?? 0
  );
}

/** `exports.expire` (hourly): remove ready exports past their expiry. */
export async function expireExports(d: MaintenanceDeps, now = new Date()): Promise<number> {
  const due = rows<{ id: string; storage_key: string | null }>(
    await d.db.execute(
      sql`SELECT id, storage_key FROM export_jobs WHERE status = 'ready' AND expires_at < ${now.toISOString()}`,
    ),
  );
  for (const e of due) {
    if (e.storage_key) await d.storage.delete(e.storage_key);
    await d.db.execute(
      sql`UPDATE export_jobs SET status = 'expired', storage_key = NULL WHERE id = ${e.id}`,
    );
  }
  return due.length;
}

/**
 * `backup.dump` (daily 01:00): pg_dump, encrypted with age, to R2
 * `backups/nexus-<date>.dump.age`; dumps older than 30 days are deleted.
 */
export async function backupDatabase(d: MaintenanceDeps, now = new Date()) {
  if (!d.dumpDatabase || !d.backupRecipient) {
    d.logger.warn('backup.dump skipped: BACKUP_AGE_RECIPIENT or pg_dump not configured');
    return { skipped: true as const };
  }
  const dump = await d.dumpDatabase();
  const enc = new Encrypter();
  enc.addRecipient(d.backupRecipient);
  const encrypted = await enc.encrypt(dump);
  const key = `backups/nexus-${now.toISOString().slice(0, 10)}.dump.age`;
  await d.storage.put(key, encrypted, 'application/octet-stream');

  const cutoff = now.getTime() - BACKUP_KEEP_DAYS * 86_400_000;
  let rotated = 0;
  for (const o of await d.storage.list('backups/')) {
    const date = /nexus-(\d{4}-\d{2}-\d{2})\.dump\.age$/.exec(o.key)?.[1];
    if (date && Date.parse(`${date}T00:00:00Z`) < cutoff) {
      await d.storage.delete(o.key);
      rotated += 1;
    }
  }
  return { skipped: false as const, key, bytes: encrypted.byteLength, rotated };
}

export { pruneVersions };
