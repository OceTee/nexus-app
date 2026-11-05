import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { notes } from './notes';
import { ownerPolicy, tstz } from './types';
import { users } from './users';

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameNorm: text('name_norm').generatedAlwaysAs(sql`lower(name)`),
    colour: text('colour'),
    serverRev: integer('server_rev').notNull().default(1),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('tags_name_format', sql`${t.name} ~ '^[^\\s#]{1,40}$'`),
    check('tags_colour_format', sql`${t.colour} IS NULL OR ${t.colour} ~ '^#[0-9A-Fa-f]{6}$'`),
    uniqueIndex('tags_user_name_uq')
      .on(t.userId, t.nameNorm)
      .where(sql`deleted_at IS NULL`),
    ownerPolicy('tags_owner'),
  ],
);

/** Note ↔ tag membership with a tombstone, merged by the set-merge rule (BR-10). */
export const noteTags = pgTable(
  'note_tags',
  {
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    primaryKey({ name: 'note_tags_pkey', columns: [t.noteId, t.tagId] }),
    index('note_tags_tag_idx')
      .on(t.tagId)
      .where(sql`deleted_at IS NULL`),
    ownerPolicy('note_tags_owner'),
  ],
);
