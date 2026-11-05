import { sql } from 'drizzle-orm';
import { type AnyPgColumn, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { ownerPolicy, tstz } from './types';
import { users } from './users';

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => collections.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
    serverRev: integer('server_rev').notNull().default(1),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('collections_name_len', sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check('collections_not_self', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    index('collections_user_parent_idx').on(t.userId, t.parentId, t.sortOrder),
    ownerPolicy('collections_owner'),
  ],
);
