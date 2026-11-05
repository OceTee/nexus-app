import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { devices } from './devices';
import { ownerPolicy, tstz } from './types';
import { users } from './users';

/** Change feed: one row per accepted op, ordered globally by `change_seq`. */
export const changes = pgTable(
  'changes',
  {
    changeSeq: bigserial('change_seq', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type', {
      enum: ['note', 'collection', 'tag', 'note_tag', 'attachment'],
    }).notNull(),
    entityId: uuid('entity_id'),
    /** Entity id, or `noteId:tagId` for memberships. */
    entityKey: text('entity_key').notNull(),
    op: text('op', { enum: ['upsert', 'delete'] }).notNull(),
    rev: integer('rev').notNull(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'changes_entity_type',
      sql`${t.entityType} IN ('note', 'collection', 'tag', 'note_tag', 'attachment')`,
    ),
    check('changes_op', sql`${t.op} IN ('upsert', 'delete')`),
    index('changes_user_seq_idx').on(t.userId, t.changeSeq),
    index('changes_user_entity_idx').on(t.userId, t.entityType, t.entityKey),
    ownerPolicy('changes_owner'),
  ],
);

/** Idempotency receipts: a repeated `opId` returns the stored result without re-applying. */
export const opReceipts = pgTable(
  'op_receipts',
  {
    opId: uuid('op_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['applied', 'conflict', 'rejected'] }).notNull(),
    result: jsonb('result').notNull().default({}),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('op_receipts_status', sql`${t.status} IN ('applied', 'conflict', 'rejected')`),
    index('op_receipts_created_idx').on(t.createdAt),
    ownerPolicy('op_receipts_owner'),
  ],
);

/**
 * Single-row server sync state. `horizonSeq` is the oldest change still in the
 * feed after compaction; cursors below it get `409 CURSOR_TOO_OLD`.
 */
export const syncStateServer = pgTable(
  'sync_state_server',
  {
    id: smallint('id').primaryKey().default(1),
    horizonSeq: bigint('horizon_seq', { mode: 'number' }).notNull().default(0),
    compactedAt: tstz('compacted_at'),
  },
  (t) => [check('sync_state_server_single_row', sql`${t.id} = 1`)],
);
