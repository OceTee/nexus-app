import type { GraphDto, GraphEdge, GraphNode, GraphQuery } from '@nexus/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { withUser, type Tx } from '../../db/withUser';
import { NotFoundError } from '../../lib/errors';

type NodeRow = {
  id: string;
  title: string;
  collection_id: string | null;
  tag_ids: string[] | null;
  degree: number;
};

/** Knowledge graph (TDD Section F, Graph). Capped at 500 nodes; most-connected first. */
export class GraphService {
  constructor(private readonly db: Db) {}

  async graph(userId: string, q: GraphQuery): Promise<GraphDto> {
    return withUser(this.db, userId, async (tx) => {
      const tagFilter = q.tagIds?.length
        ? sql`AND EXISTS (SELECT 1 FROM note_tags f WHERE f.note_id = n.id AND f.deleted_at IS NULL
                          AND f.tag_id = ANY(${sql.param(q.tagIds)}::uuid[]))`
        : sql``;
      const result = await tx.execute<NodeRow & { total: number }>(sql`
        WITH nodes AS (
          SELECT n.id, n.title, n.collection_id,
                 (SELECT array_agg(nt.tag_id ORDER BY nt.created_at) FROM note_tags nt
                   WHERE nt.note_id = n.id AND nt.deleted_at IS NULL) AS tag_ids,
                 (SELECT count(*) FROM note_links l JOIN notes t ON t.id = l.target_note_id AND t.deleted_at IS NULL
                   WHERE l.source_note_id = n.id)
               + (SELECT count(*) FROM note_links l JOIN notes s ON s.id = l.source_note_id AND s.deleted_at IS NULL
                   WHERE l.target_note_id = n.id) AS degree
          FROM notes n
          WHERE n.deleted_at IS NULL
            ${q.collectionId ? sql`AND n.collection_id = ${q.collectionId}` : sql``}
            ${q.from ? sql`AND n.updated_at >= ${q.from}` : sql``}
            ${q.to ? sql`AND n.updated_at <= ${q.to}` : sql``}
            ${tagFilter}
        )
        SELECT *, count(*) OVER () AS total FROM nodes
        ${q.orphans === false ? sql`WHERE degree > 0` : sql``}
        ORDER BY degree DESC, id
        LIMIT ${q.limit}`);
      const rows = result.rows;
      const nodes = rows.map(toNode);
      const edges = await this.edges(
        tx,
        nodes.map((n) => n.id),
        q.includeTagEdges ?? false,
      );
      return { nodes, edges, truncated: Number(rows[0]?.total ?? 0) > rows.length };
    });
  }

  /** 1- or 2-hop neighbourhood of a note (links in either direction). */
  async neighbours(userId: string, noteId: string, depth: 1 | 2): Promise<GraphDto> {
    return withUser(this.db, userId, async (tx) => {
      const result = await tx.execute<NodeRow>(sql`
        WITH RECURSIVE hop AS (
          SELECT ${noteId}::uuid AS id, 0 AS d
          UNION
          SELECT CASE WHEN l.source_note_id = hop.id THEN l.target_note_id ELSE l.source_note_id END, hop.d + 1
          FROM hop JOIN note_links l ON (l.source_note_id = hop.id OR l.target_note_id = hop.id)
          WHERE hop.d < ${depth} AND l.target_note_id IS NOT NULL
        )
        SELECT n.id, n.title, n.collection_id,
               (SELECT array_agg(nt.tag_id ORDER BY nt.created_at) FROM note_tags nt
                 WHERE nt.note_id = n.id AND nt.deleted_at IS NULL) AS tag_ids,
               (SELECT count(*) FROM note_links l WHERE l.source_note_id = n.id AND l.target_note_id IS NOT NULL)
             + (SELECT count(*) FROM note_links l WHERE l.target_note_id = n.id) AS degree
        FROM notes n WHERE n.deleted_at IS NULL AND n.id IN (SELECT DISTINCT id FROM hop)
        ORDER BY degree DESC, n.id
        LIMIT 500`);
      if (!result.rows.some((r) => r.id === noteId)) throw new NotFoundError('Note');
      const nodes = result.rows.map(toNode);
      return {
        nodes,
        edges: await this.edges(
          tx,
          nodes.map((n) => n.id),
          false,
        ),
        truncated: false,
      };
    });
  }

  private async edges(tx: Tx, ids: string[], includeTagEdges: boolean): Promise<GraphEdge[]> {
    if (ids.length === 0) return [];
    const list = sql`${sql.param(ids)}::uuid[]`;
    const links = await tx.execute<{ source: string; target: string }>(sql`
      SELECT DISTINCT source_note_id AS source, target_note_id AS target FROM note_links
      WHERE source_note_id = ANY(${list}) AND target_note_id = ANY(${list}) AND source_note_id <> target_note_id`);
    const edges: GraphEdge[] = links.rows.map((r) => ({
      source: r.source,
      target: r.target,
      kind: 'link',
    }));
    if (includeTagEdges) {
      const shared = await tx.execute<{ source: string; target: string }>(sql`
        SELECT DISTINCT a.note_id AS source, b.note_id AS target
        FROM note_tags a JOIN note_tags b ON a.tag_id = b.tag_id AND a.note_id < b.note_id
        WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
          AND a.note_id = ANY(${list}) AND b.note_id = ANY(${list})`);
      edges.push(
        ...shared.rows.map((r) => ({ source: r.source, target: r.target, kind: 'tag' as const })),
      );
    }
    return edges;
  }
}

function toNode(r: NodeRow): GraphNode {
  return {
    id: r.id,
    title: r.title,
    degree: Number(r.degree),
    collectionId: r.collection_id,
    tagIds: r.tag_ids ?? [],
  };
}
