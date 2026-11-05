import { sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { notes } from './notes';
import { ownerPolicy, tstz } from './types';
import { users } from './users';

/** Parsed `[[wiki-links]]`; `targetNoteId` is null for a ghost link (BR-05, BR-06). */
export const noteLinks = pgTable(
  'note_links',
  {
    sourceNoteId: uuid('source_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetTitleNorm: text('target_title_norm').notNull(),
    targetNoteId: uuid('target_note_id').references(() => notes.id, { onDelete: 'set null' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'note_links_pkey', columns: [t.sourceNoteId, t.targetTitleNorm] }),
    index('note_links_target_idx').on(t.userId, t.targetNoteId),
    index('note_links_ghost_idx')
      .on(t.userId, t.targetTitleNorm)
      .where(sql`target_note_id IS NULL`),
    ownerPolicy('note_links_owner'),
  ],
);
