import { LIMITS } from '@nexus/shared';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { getDb } from '@/infra/db';
import type { GraphFilters } from './store';

export interface GraphNode {
  id: string;
  title: string;
  excerpt: string;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'link' | 'tag';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Notes matching the filters before the 500-node cap. */
  total: number;
}

/** Tags with more notes than this add no shared-tag edges (they would join everything). */
const TAG_EDGE_MAX_NOTES = 30;

/** Notes and links passing the filters, newest 500 (S-23, S-24). */
export async function loadGraph(f: GraphFilters): Promise<GraphData> {
  const db = getDb();
  const where = ['n.deleted_at IS NULL'];
  const params: string[] = [];
  if (f.collectionId) {
    where.push('n.collection_id = ?');
    params.push(f.collectionId);
  }
  if (f.tagIds.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.deleted_at IS NULL
               AND t.tag_id IN (${f.tagIds.map(() => '?').join(',')}))`,
    );
    params.push(...f.tagIds);
  }
  const rows = await db.getAllAsync<{ id: string; title: string; excerpt: string }>(
    `SELECT n.id, n.title, n.excerpt FROM notes n WHERE ${where.join(' AND ')} ORDER BY n.updated_at DESC`,
    params,
  );
  const capped = rows.slice(0, LIMITS.graphNodesMax);
  const ids = new Set(capped.map((r) => r.id));

  const links = await db.getAllAsync<{ s: string; t: string }>(
    `SELECT DISTINCT source_note_id AS s, target_note_id AS t FROM note_links
     WHERE target_note_id IS NOT NULL AND source_note_id != target_note_id`,
  );
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  const add = (a: string, b: string, kind: GraphEdge['kind']) => {
    if (!ids.has(a) || !ids.has(b) || a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source: a, target: b, kind });
  };
  for (const l of links) add(l.s, l.t, 'link');

  if (f.tagEdges) {
    const memberships = await db.getAllAsync<{ tag_id: string; note_id: string }>(
      `SELECT tag_id, note_id FROM note_tags WHERE deleted_at IS NULL`,
    );
    const byTag = new Map<string, string[]>();
    for (const m of memberships) {
      if (!ids.has(m.note_id)) continue;
      byTag.set(m.tag_id, [...(byTag.get(m.tag_id) ?? []), m.note_id]);
    }
    for (const notes of byTag.values()) {
      if (notes.length > TAG_EDGE_MAX_NOTES) continue;
      for (let i = 0; i < notes.length; i += 1) {
        for (let j = i + 1; j < notes.length; j += 1) add(notes[i]!, notes[j]!, 'tag');
      }
    }
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes = capped
    .map((r) => ({
      id: r.id,
      title: r.title || 'Untitled',
      excerpt: r.excerpt,
      degree: degree.get(r.id) ?? 0,
    }))
    .filter((n) => f.showOrphans || n.degree > 0);
  return { nodes, edges, total: rows.length };
}

export interface Positioned extends GraphNode {
  x: number;
  y: number;
  r: number;
}

type SimNode = SimulationNodeDatum & GraphNode;

/** Node radius grows with the number of connections. */
export const radiusFor = (degree: number) => Math.min(18, 5 + Math.sqrt(degree) * 2.6);

/**
 * Force-directed layout (d3-force), run to rest synchronously so nodes appear
 * in their final positions (no layout animation; reduced-motion friendly).
 * Pinned nodes keep their saved positions.
 */
export function layoutGraph(
  data: GraphData,
  pinned: Record<string, { x: number; y: number }>,
): Positioned[] {
  const nodes: SimNode[] = data.nodes.map((n, i) => {
    const p = pinned[n.id];
    // Deterministic start on a spiral so layouts are stable between runs.
    const a = i * 2.399963;
    const rad = 10 * Math.sqrt(i + 1);
    return p
      ? { ...n, x: p.x, y: p.y, fx: p.x, fy: p.y }
      : { ...n, x: rad * Math.cos(a), y: rad * Math.sin(a) };
  });
  const links: SimulationLinkDatum<SimNode>[] = data.edges.map((e) => ({
    source: e.source,
    target: e.target,
  }));
  const sim = forceSimulation<SimNode>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((d) => d.id)
        .distance(60)
        .strength(0.5),
    )
    .force('charge', forceManyBody<SimNode>().strength(-120).distanceMax(400))
    .force(
      'collide',
      forceCollide<SimNode>((d) => radiusFor(d.degree) + 4),
    )
    .force('x', forceX<SimNode>(0).strength(0.04))
    .force('y', forceY<SimNode>(0).strength(0.04))
    .force('center', forceCenter(0, 0))
    .stop();
  const ticks = Math.min(300, Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay())));
  for (let i = 0; i < ticks; i += 1) sim.tick();
  return nodes.map((n) => ({
    id: n.id,
    title: n.title,
    excerpt: n.excerpt,
    degree: n.degree,
    x: n.x ?? 0,
    y: n.y ?? 0,
    r: radiusFor(n.degree),
  }));
}
