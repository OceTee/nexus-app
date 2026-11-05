import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { ownerPolicy, tstz } from './types';
import { users } from './users';

/** Server-side export jobs (post-MVP, feature-flagged). */
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    format: text('format', { enum: ['markdown_zip', 'json'] }).notNull(),
    scopeCollectionId: uuid('scope_collection_id'),
    status: text('status', { enum: ['queued', 'running', 'ready', 'failed', 'expired'] })
      .notNull()
      .default('queued'),
    storageKey: text('storage_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    error: text('error'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    completedAt: tstz('completed_at'),
    expiresAt: tstz('expires_at'),
  },
  (t) => [
    check('export_jobs_format', sql`${t.format} IN ('markdown_zip', 'json')`),
    check(
      'export_jobs_status',
      sql`${t.status} IN ('queued', 'running', 'ready', 'failed', 'expired')`,
    ),
    index('export_jobs_user_idx').on(t.userId, t.createdAt.desc()),
    ownerPolicy('export_jobs_owner'),
  ],
);
