import { bigserial, index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { ownerPolicy, tstz } from './types';
import { users } from './users';

/** Security events (no secrets, no note content). Kept after the user is deleted. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_user_idx').on(t.userId, t.createdAt.desc()),
    ownerPolicy('audit_logs_owner'),
  ],
);
