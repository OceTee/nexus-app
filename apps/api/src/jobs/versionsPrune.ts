import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

export const VERSION_KEEP_PER_NOTE = 50;
export const VERSION_MAX_AGE_DAYS = 90;

/**
 * `versions.prune` (TDD Section D, Version history; test T-29): keeps the
 * newest 50 non-conflict versions per note and none older than 90 days,
 * whichever is stricter. Open conflicts are untouched; resolved conflicts go
 * 90 days after resolution. Runs across users, so it needs the maintenance
 * role (BYPASSRLS) or the owner. Returns the number of rows deleted.
 */
export async function pruneVersions(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - VERSION_MAX_AGE_DAYS * 86_400_000).toISOString();
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY note_id ORDER BY rev DESC, created_at DESC) AS rn
      FROM note_versions WHERE conflict = false
    )
    DELETE FROM note_versions v
    WHERE (v.conflict = false AND (
             v.created_at < ${cutoff}
             OR v.id IN (SELECT id FROM ranked WHERE rn > ${VERSION_KEEP_PER_NOTE})))
       OR (v.conflict = true AND v.resolved_at IS NOT NULL AND v.resolved_at < ${cutoff})`);
  return result.rowCount ?? 0;
}
