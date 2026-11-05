import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgPolicy, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { citext, tstz } from './types';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique('users_email_key'),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull().default(''),
    emailVerifiedAt: tstz('email_verified_at'),
    settings: jsonb('settings').notNull().default({}),
    deletionRequestedAt: tstz('deletion_requested_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('users_display_name_len', sql`char_length(${t.displayName}) <= 80`),
    index('users_deletion_idx')
      .on(t.deletionRequestedAt)
      .where(sql`deletion_requested_at IS NOT NULL`),
    pgPolicy('users_self', {
      for: 'all',
      using: sql`id = app_user_id()`,
      withCheck: sql`id = app_user_id()`,
    }),
  ],
);
