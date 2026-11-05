import { z } from 'zod';
import { LIMITS } from '../limits';
import { IsoDateTime, ServerRev, UuidV7 } from './common';

const Name = z.string().trim().min(1).max(LIMITS.collectionNameMax);
/** Lucide icon name, e.g. `folder` or `book-open`. */
const Icon = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a Lucide icon name')
  .max(64);
const SortOrder = z.number().int().min(0).max(1_000_000);

export const CollectionCreateInput = z.object({
  id: UuidV7,
  parentId: UuidV7.nullable().default(null),
  name: Name,
  icon: Icon.nullable().optional(),
  sortOrder: SortOrder.optional(),
});
export type CollectionCreateInput = z.infer<typeof CollectionCreateInput>;

/** Payload of a `collection.upsert` sync op. */
export const CollectionPayload = CollectionCreateInput.omit({ id: true });
export type CollectionPayload = z.infer<typeof CollectionPayload>;

export const CollectionUpdateInput = z.object({
  name: Name.optional(),
  icon: Icon.nullable().optional(),
  sortOrder: SortOrder.optional(),
  baseRev: ServerRev,
});
export type CollectionUpdateInput = z.infer<typeof CollectionUpdateInput>;

export const CollectionMoveInput = z.object({
  parentId: UuidV7.nullable(),
  sortOrder: SortOrder.optional(),
});
export type CollectionMoveInput = z.infer<typeof CollectionMoveInput>;

export const CollectionParams = z.object({ collectionId: UuidV7 });

export const CollectionDto = z.object({
  id: UuidV7,
  parentId: UuidV7.nullable(),
  name: z.string(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  noteCount: z.number().int().min(0),
  serverRev: ServerRev,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CollectionDto = z.infer<typeof CollectionDto>;

export const CollectionListDto = z.object({ items: z.array(CollectionDto) });
