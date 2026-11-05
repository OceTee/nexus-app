import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { notes } from './notes';
import { ownerPolicy, tstz } from './types';
import { users } from './users';

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noteId: uuid('note_id').references(() => notes.id, { onDelete: 'set null' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type', {
      enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique('attachments_storage_key_key'),
    sha256: text('sha256').notNull(),
    status: text('status', { enum: ['pending', 'uploaded', 'deleted'] })
      .notNull()
      .default('pending'),
    width: integer('width'),
    height: integer('height'),
    serverRev: integer('server_rev').notNull().default(1),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('attachments_filename_len', sql`char_length(${t.filename}) BETWEEN 1 AND 255`),
    check(
      'attachments_mime_type',
      sql`${t.mimeType} IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')`,
    ),
    check('attachments_size', sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 26214400`),
    check('attachments_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('attachments_status', sql`${t.status} IN ('pending', 'uploaded', 'deleted')`),
    index('attachments_user_note_idx').on(t.userId, t.noteId),
    index('attachments_pending_idx')
      .on(t.createdAt)
      .where(sql`status = 'pending'`),
    ownerPolicy('attachments_owner'),
  ],
);
