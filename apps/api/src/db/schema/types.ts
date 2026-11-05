import { sql } from 'drizzle-orm';
import { customType, pgPolicy, timestamp } from 'drizzle-orm/pg-core';

/** Case-insensitive text (`citext` extension), used for email addresses. */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** Full-text search vector; generated in the database, never written by the app. */
export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** `timestamptz` column returning ISO strings, matching the API's wire format. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Standard row-level security policy: rows are visible only to their owner. */
export const ownerPolicy = (name: string) =>
  pgPolicy(name, {
    for: 'all',
    using: sql`user_id = app_user_id()`,
    withCheck: sql`user_id = app_user_id()`,
  });
