import { z } from 'zod';
import { LIMITS } from '../limits';
import { IsoDateTime, QueryBoolean, UuidV7 } from './common';

/** Comma-separated ids in a query string, e.g. `tagIds=a,b`. */
const IdList = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(UuidV7).max(50));

export const GraphQuery = z.object({
  collectionId: UuidV7.optional(),
  tagIds: IdList.optional(),
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  includeTagEdges: QueryBoolean.optional(),
  orphans: QueryBoolean.optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.graphNodesMax).default(LIMITS.graphNodesMax),
});
export type GraphQuery = z.infer<typeof GraphQuery>;

export const GraphNeighboursQuery = z.object({
  depth: z.coerce
    .number()
    .pipe(z.union([z.literal(1), z.literal(2)]))
    .default(1),
});

export const GraphNode = z.object({
  id: UuidV7,
  title: z.string(),
  degree: z.number().int().min(0),
  collectionId: UuidV7.nullable(),
  tagIds: z.array(UuidV7),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdgeKind = z.enum(['link', 'tag']);

export const GraphEdge = z.object({ source: UuidV7, target: UuidV7, kind: GraphEdgeKind });
export type GraphEdge = z.infer<typeof GraphEdge>;

export const GraphDto = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  /** True when more than `limit` nodes matched and the result was cut. */
  truncated: z.boolean(),
});
export type GraphDto = z.infer<typeof GraphDto>;
