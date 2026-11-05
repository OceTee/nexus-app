import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { ownerPolicy, tstz } from './types';
import { users } from './users';

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    platform: text('platform', { enum: ['ios', 'android'] }).notNull(),
    appVersion: text('app_version').notNull().default(''),
    pushToken: text('push_token'),
    lastPullSeq: bigint('last_pull_seq', { mode: 'number' }).notNull().default(0),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    check('devices_name_len', sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check('devices_platform', sql`${t.platform} IN ('ios', 'android')`),
    index('devices_user_idx')
      .on(t.userId)
      .where(sql`revoked_at IS NULL`),
    ownerPolicy('devices_owner'),
  ],
);
