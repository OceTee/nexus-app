import { z } from 'zod';
import { LIMITS } from '../limits';
import { AttachmentMetaInput } from './attachments';
import { CollectionPayload } from './collections';
import { BaseRev, IsoDateTime, Uuid, UuidV7 } from './common';
import { NotePayload } from './notes';
import { TagPayload } from './tags';

/** Version of the client's local schema; the server rejects versions it no longer supports. */
export const CLIENT_SCHEMA_VERSION = 1;

const base = { opId: UuidV7, createdAt: IsoDateTime };
const entity = { entityId: UuidV7, baseRev: BaseRev };
const membership = { noteId: UuidV7, tagId: UuidV7 };

/** One queued change from a device's outbox (TDD Section F, Input validation). */
export const SyncOp = z.discriminatedUnion('type', [
  z.object({ ...base, ...entity, type: z.literal('note.upsert'), payload: NotePayload }),
  z.object({ ...base, ...entity, type: z.literal('note.delete') }),
  z.object({
    ...base,
    ...entity,
    type: z.literal('collection.upsert'),
    payload: CollectionPayload,
  }),
  z.object({ ...base, ...entity, type: z.literal('collection.delete') }),
  z.object({ ...base, ...entity, type: z.literal('tag.upsert'), payload: TagPayload }),
  z.object({ ...base, ...entity, type: z.literal('tag.delete') }),
  z.object({ ...base, ...membership, type: z.literal('note_tag.add') }),
  z.object({ ...base, ...membership, type: z.literal('note_tag.remove') }),
  z.object({
    ...base,
    ...entity,
    type: z.literal('attachment.upsert'),
    payload: AttachmentMetaInput,
  }),
  z.object({ ...base, ...entity, type: z.literal('attachment.delete') }),
]);
export type SyncOp = z.infer<typeof SyncOp>;
export type SyncOpType = SyncOp['type'];

export const SyncPushRequest = z.object({
  deviceId: UuidV7,
  /** Last change sequence the device has applied (0 on first sync). */
  cursor: z.number().int().min(0),
  ops: z.array(SyncOp).max(LIMITS.syncOpsPerBatch),
  clientSchema: z.number().int().min(1),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

export const OpStatus = z.enum(['applied', 'conflict', 'rejected']);
export type OpStatus = z.infer<typeof OpStatus>;

export const OpResult = z.object({
  opId: UuidV7,
  status: OpStatus,
  serverRev: z.number().int().optional(),
  conflictVersionId: Uuid.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type OpResult = z.infer<typeof OpResult>;

export const EntityType = z.enum(['note', 'collection', 'tag', 'note_tag', 'attachment']);
export type EntityType = z.infer<typeof EntityType>;

/** One row of the change feed. `entityKey` is the id, or `noteId:tagId` for memberships. */
export const SyncChange = z.object({
  seq: z.number().int().min(1),
  entityType: EntityType,
  entityKey: z.string(),
  op: z.enum(['upsert', 'delete']),
  rev: z.number().int(),
  data: z.unknown().nullable(),
});
export type SyncChange = z.infer<typeof SyncChange>;

export const ConflictDto = z.object({
  noteId: UuidV7,
  versionId: Uuid,
  serverRev: z.number().int(),
  deviceId: UuidV7.nullable(),
  createdAt: IsoDateTime,
});
export type ConflictDto = z.infer<typeof ConflictDto>;

export const SyncResponse = z.object({
  results: z.array(OpResult),
  changes: z.array(SyncChange),
  conflicts: z.array(ConflictDto),
  cursor: z.number().int().min(0),
  hasMore: z.boolean(),
  serverTime: IsoDateTime,
});
export type SyncResponse = z.infer<typeof SyncResponse>;

export const SnapshotQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.snapshotPageMax).default(LIMITS.snapshotPageMax),
});

export const SnapshotPageDto = z.object({
  items: z.array(SyncChange.extend({ op: z.literal('upsert') })),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  /** Change sequence to adopt as the cursor once the last page is applied. */
  changeSeq: z.number().int().min(0),
});
export type SnapshotPageDto = z.infer<typeof SnapshotPageDto>;

export const SyncStatusDto = z.object({
  serverSeq: z.number().int().min(0),
  /** Oldest sequence still in the change feed; older cursors must re-snapshot. */
  horizonSeq: z.number().int().min(0),
  devices: z.array(
    z.object({
      id: UuidV7,
      name: z.string(),
      lastPullSeq: z.number().int().min(0),
      lastSeenAt: IsoDateTime,
    }),
  ),
  openConflicts: z.number().int().min(0),
});
export type SyncStatusDto = z.infer<typeof SyncStatusDto>;
