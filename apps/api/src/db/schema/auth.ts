import { sql } from 'drizzle-orm';
import { type AnyPgColumn, check, index, inet, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { devices } from './devices';
import { tstz } from './types';
import { users } from './users';

/** Single-use tokens sent by email for verification (24 h) and password reset (30 min). */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['verify', 'reset'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique('email_tokens_token_hash_key'),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('email_tokens_purpose', sql`${t.purpose} IN ('verify', 'reset')`),
    index('email_tokens_user_idx').on(t.userId, t.purpose),
  ],
);

/**
 * Rotating refresh tokens, one family per device sign-in. No RLS: tokens are
 * looked up by hash before a user context exists.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique('refresh_tokens_token_hash_key'),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'set null',
    }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastUsedAt: tstz('last_used_at'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('refresh_tokens_family_idx').on(t.familyId, t.createdAt.desc()),
    index('refresh_tokens_user_idx')
      .on(t.userId)
      .where(sql`revoked_at IS NULL`),
  ],
);
