import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { collections } from './collections';
import { devices } from './devices';
import { ownerPolicy, tsvector, tstz } from './types';
import { users } from './users';

/**
 * Database twin of `normaliseTitle` in @nexus/shared: NFC, collapse whitespace,
 * trim, lower-case. The TDD sketch used `lower(btrim(title))`, which would not
 * match `[[Kalman  Filtering]]` (double space) to its note.
 */
export const TITLE_NORM_SQL = sql`lower(btrim(regexp_replace(normalize(title, NFC), '\\s+', ' ', 'g')))`;

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id').references(() => collections.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull().default(''),
    titleNorm: text('title_norm').generatedAlwaysAs(TITLE_NORM_SQL),
    bodyMd: text('body_md').notNull().default(''),
    /** Plain text from `stripMarkdown`, feeding search. */
    bodyText: text('body_text').notNull().default(''),
    excerpt: text('excerpt').notNull().default(''),
    wordCount: integer('word_count').notNull().default(0),
    isPinned: boolean('is_pinned').notNull().default(false),
    serverRev: integer('server_rev').notNull().default(1),
    contentHash: text('content_hash').notNull().default(''),
    lastDeviceId: uuid('last_device_id').references(() => devices.id, { onDelete: 'set null' }),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(body_text, ''))`,
    ),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('notes_title_len', sql`char_length(${t.title}) <= 200`),
    check('notes_body_len', sql`char_length(${t.bodyMd}) <= 200000`),
    index('notes_user_updated_idx')
      .on(t.userId, t.updatedAt.desc())
      .where(sql`deleted_at IS NULL`),
    index('notes_user_title_norm_idx').on(t.userId, t.titleNorm),
    index('notes_collection_idx')
      .on(t.collectionId)
      .where(sql`deleted_at IS NULL`),
    index('notes_search_idx').using('gin', t.searchTsv),
    index('notes_trash_idx')
      .on(t.userId, t.deletedAt)
      .where(sql`deleted_at IS NOT NULL`),
    ownerPolicy('notes_owner'),
  ],
);

export const noteVersions = pgTable(
  'note_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rev: integer('rev').notNull(),
    baseRev: integer('base_rev'),
    title: text('title').notNull(),
    bodyMd: text('body_md').notNull(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    conflict: boolean('conflict').notNull().default(false),
    resolvedAt: tstz('resolved_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('note_versions_note_rev_uq')
      .on(t.noteId, t.rev)
      .where(sql`conflict = false`),
    index('note_versions_note_idx').on(t.noteId, t.createdAt.desc()),
    index('note_versions_prune_idx')
      .on(t.createdAt)
      .where(sql`conflict = false`),
    index('note_versions_open_conflict_idx')
      .on(t.userId, t.noteId)
      .where(sql`conflict = true AND resolved_at IS NULL`),
    ownerPolicy('note_versions_owner'),
  ],
);
