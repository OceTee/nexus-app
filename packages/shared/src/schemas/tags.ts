import { z } from 'zod';
import { LIMITS } from '../limits';
import { HexColour, ServerRev, UuidV7 } from './common';

/** 1–40 characters, no whitespace or `#` (the `#` is display-only). */
export const TagName = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.tagNameMax)
  .regex(/^[^\s#]+$/, 'must not contain spaces or #');

export const TagCreateInput = z.object({
  id: UuidV7,
  name: TagName,
  colour: HexColour.nullable().optional(),
});
export type TagCreateInput = z.infer<typeof TagCreateInput>;

/** Payload of a `tag.upsert` sync op. */
export const TagPayload = TagCreateInput.omit({ id: true });
export type TagPayload = z.infer<typeof TagPayload>;

export const TagUpdateInput = z.object({
  name: TagName.optional(),
  colour: HexColour.nullable().optional(),
  baseRev: ServerRev,
});
export type TagUpdateInput = z.infer<typeof TagUpdateInput>;

export const TagMergeInput = z.object({ targetTagId: UuidV7 });
export const TagMergeResultDto = z.object({ movedNotes: z.number().int().min(0) });

export const TagParams = z.object({ tagId: UuidV7 });

export const TagDto = z.object({
  id: UuidV7,
  name: z.string(),
  colour: z.string().nullable(),
  noteCount: z.number().int().min(0),
  serverRev: ServerRev,
});
export type TagDto = z.infer<typeof TagDto>;

export const TagListDto = z.object({ items: z.array(TagDto) });
