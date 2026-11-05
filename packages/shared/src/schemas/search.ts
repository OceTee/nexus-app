import { z } from 'zod';
import { LIMITS } from '../limits';
import { IsoDateTime, PageQuery, UuidV7 } from './common';

export const SearchQuery = PageQuery.extend({
  q: z.string().trim().min(1).max(LIMITS.searchQueryMax),
  collectionId: UuidV7.optional(),
  tagId: UuidV7.optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchHitDto = z.object({
  noteId: UuidV7,
  title: z.string(),
  /** Matching passage with the matched terms highlighted. */
  snippet: z.string(),
  rank: z.number(),
  updatedAt: IsoDateTime,
});
export type SearchHitDto = z.infer<typeof SearchHitDto>;
