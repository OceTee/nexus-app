import {
  decodeCursor,
  encodeCursor,
  type Paginated,
  type SearchHitDto,
  type SearchQuery,
} from '@nexus/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { withUser } from '../../db/withUser';
import { ValidationError } from '../../lib/errors';
import { iso } from '../content/derive';

/** Ranks come back as float4 text, so cursors compare exactly what the query produced. */
const SearchCursor = z.object({ rank: z.number(), id: z.string() });

type HitRow = {
  id: string;
  title: string;
  snippet: string;
  rank: number;
  updated_at: string;
};

/**
 * Server-side parity search (TDD Section F, Graph and search). Uses the
 * generated `search_tsv` column. `websearch_to_tsquery` never raises a syntax
 * error, so any user input is safe (FTS syntax is treated as text or phrases).
 */
export class SearchService {
  constructor(private readonly db: Db) {}

  async search(userId: string, q: SearchQuery): Promise<Paginated<SearchHitDto>> {
    let after: z.infer<typeof SearchCursor> | undefined;
    if (q.cursor) {
      try {
        after = decodeCursor(q.cursor, SearchCursor);
      } catch {
        throw new ValidationError([
          { path: ['cursor'], issue: 'invalid_cursor', message: 'Invalid cursor' },
        ]);
      }
    }
    return withUser(this.db, userId, async (tx) => {
      const query = sql`websearch_to_tsquery('english', ${q.q})`;
      const scope = q.collectionId
        ? sql`AND n.collection_id IN (
            WITH RECURSIVE sub AS (
              SELECT id FROM collections WHERE id = ${q.collectionId} AND deleted_at IS NULL
              UNION ALL
              SELECT c.id FROM collections c JOIN sub ON c.parent_id = sub.id WHERE c.deleted_at IS NULL
            ) SELECT id FROM sub)`
        : sql``;
      const tag = q.tagId
        ? sql`AND EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag_id = ${q.tagId} AND t.deleted_at IS NULL)`
        : sql``;
      const result = await tx.execute<HitRow>(sql`
        SELECT * FROM (
          SELECT n.id, n.title, n.updated_at,
                 ts_rank(n.search_tsv, ${query})::float4 AS rank,
                 ts_headline('english', coalesce(nullif(n.body_text, ''), n.title), ${query},
                   'StartSel=**,StopSel=**,MaxWords=24,MinWords=8,MaxFragments=1') AS snippet
          FROM notes n
          WHERE n.deleted_at IS NULL AND n.search_tsv @@ ${query} ${scope} ${tag}
        ) hits
        ${after ? sql`WHERE (hits.rank, hits.id) < (${after.rank}::float4, ${after.id}::uuid)` : sql``}
        ORDER BY hits.rank DESC, hits.id DESC
        LIMIT ${q.limit + 1}`);
      const rows = result.rows.slice(0, q.limit);
      const last = rows.at(-1);
      return {
        items: rows.map((r) => ({
          noteId: r.id,
          title: r.title,
          snippet: r.snippet,
          rank: Number(r.rank),
          updatedAt: iso(r.updated_at),
        })),
        hasMore: result.rows.length > q.limit,
        nextCursor:
          result.rows.length > q.limit && last
            ? encodeCursor({ rank: Number(last.rank), id: last.id })
            : null,
      };
    });
  }
}
