import { z } from 'zod';
import { LIMITS } from '../limits';
import { BaseRev, IsoDateTime, PageQuery, QueryBoolean, ServerRev, Uuid, UuidV7 } from './common';

const Title = z.string().max(LIMITS.noteTitleMax);
const BodyMd = z.string().max(LIMITS.noteBodyMax);
const TagIds = z.array(UuidV7).max(LIMITS.tagsPerNoteMax);

/** Editable note fields without defaults (the base for partial updates). */
const NoteFields = z.object({
  title: Title,
  bodyMd: BodyMd,
  collectionId: UuidV7.nullable(),
  isPinned: z.boolean(),
  tagIds: TagIds,
});

/** `POST /v1/notes`; also the payload (without `id`) of a `note.upsert` sync op. */
export const NoteCreateInput = z.object({
  id: UuidV7,
  title: Title.default(''),
  bodyMd: BodyMd.default(''),
  collectionId: UuidV7.nullable().default(null),
  isPinned: z.boolean().default(false),
  tagIds: TagIds.default([]),
});
export type NoteCreateInput = z.infer<typeof NoteCreateInput>;

/** Note content without the id, as carried by `note.upsert`. */
export const NotePayload = NoteCreateInput.omit({ id: true });
export type NotePayload = z.infer<typeof NotePayload>;

/**
 * `PATCH /v1/notes/:noteId`: any subset of fields plus the revision the client edited.
 * Built from fields without defaults: in Zod 4, `.partial()` keeps defaults, so
 * deriving from `NotePayload` would silently reset omitted fields.
 */
export const NoteUpdateInput = NoteFields.partial().extend({ baseRev: ServerRev });
export type NoteUpdateInput = z.infer<typeof NoteUpdateInput>;

export const NoteParams = z.object({ noteId: UuidV7 });
export const NoteVersionParams = z.object({ noteId: UuidV7, versionId: Uuid });
export const NoteTagParams = z.object({ noteId: UuidV7, tagId: UuidV7 });

export const NoteListQuery = PageQuery.extend({
  collectionId: UuidV7.optional(),
  tagId: UuidV7.optional(),
  pinned: QueryBoolean.optional(),
});
export type NoteListQuery = z.infer<typeof NoteListQuery>;

export const NoteDto = z.object({
  id: UuidV7,
  title: z.string(),
  bodyMd: z.string(),
  excerpt: z.string(),
  collectionId: UuidV7.nullable(),
  isPinned: z.boolean(),
  wordCount: z.number().int().min(0),
  serverRev: ServerRev,
  tagIds: z.array(UuidV7),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: IsoDateTime.nullable(),
});
export type NoteDto = z.infer<typeof NoteDto>;

/** List item: a note without its body. */
export const NoteSummaryDto = NoteDto.omit({ bodyMd: true });
export type NoteSummaryDto = z.infer<typeof NoteSummaryDto>;

/** Trash list item, with the date it will be purged. */
export const TrashedNoteDto = NoteSummaryDto.extend({
  deletedAt: IsoDateTime,
  purgeAt: IsoDateTime,
});
export type TrashedNoteDto = z.infer<typeof TrashedNoteDto>;

export const NoteVersionDto = z.object({
  id: Uuid,
  rev: z.number().int().min(1),
  baseRev: BaseRev,
  conflict: z.boolean(),
  resolvedAt: IsoDateTime.nullable(),
  deviceName: z.string().nullable(),
  wordCount: z.number().int().min(0),
  createdAt: IsoDateTime,
});
export type NoteVersionDto = z.infer<typeof NoteVersionDto>;

export const NoteVersionDetailDto = NoteVersionDto.extend({
  title: z.string(),
  bodyMd: z.string(),
});
export type NoteVersionDetailDto = z.infer<typeof NoteVersionDetailDto>;

export const NoteVersionListQuery = PageQuery.extend({
  limit: z.coerce.number().int().min(1).max(LIMITS.versionsPageMax).default(LIMITS.pageDefault),
});

export const BacklinkDto = z.object({
  noteId: UuidV7,
  title: z.string(),
  /** The sentence containing the link. */
  context: z.string(),
});
export type BacklinkDto = z.infer<typeof BacklinkDto>;

export const OutgoingLinkDto = z.object({
  targetTitle: z.string(),
  /** Null for a ghost link (no note with that title yet). */
  targetNoteId: UuidV7.nullable(),
});
export type OutgoingLinkDto = z.infer<typeof OutgoingLinkDto>;

export const ConflictStrategy = z.enum(['keep_server', 'keep_mine', 'merged']);
export type ConflictStrategy = z.infer<typeof ConflictStrategy>;

export const ResolveConflictInput = z
  .object({
    strategy: ConflictStrategy,
    title: Title.optional(),
    bodyMd: BodyMd.optional(),
    baseRev: ServerRev,
  })
  .refine((v) => v.strategy !== 'merged' || v.bodyMd !== undefined, {
    message: 'bodyMd is required for a merged resolution',
    path: ['bodyMd'],
  });
export type ResolveConflictInput = z.infer<typeof ResolveConflictInput>;

/** `PUT /v1/notes/:noteId/tags` replaces the whole tag set. */
export const NoteTagsReplaceInput = z.object({ tagIds: TagIds });

/** 409 body when `baseRev` is stale; the client copy is kept as a conflict version. */
export const NoteConflictDetails = z.object({ serverRev: ServerRev, conflictVersionId: Uuid });
