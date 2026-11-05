import { GraphNeighboursQuery, GraphQuery, NoteParams, SearchQuery } from '@nexus/shared';
import { Router } from 'express';
import { input, validate } from '../../http/middleware/validate';
import type { SearchService } from '../search/search.service';
import type { GraphService } from './graph.service';

/** `/v1/graph`, `/v1/graph/neighbours/:noteId` and `/v1/search`. Mounted behind requireAuth. */
export function graphAndSearchRouter(graph: GraphService, search: SearchService): Router {
  const r = Router();

  r.get('/graph', validate({ query: GraphQuery }), async (req, res) => {
    res.json(await graph.graph(req.auth.userId, input(req.valid.query)));
  });

  r.get(
    '/graph/neighbours/:noteId',
    validate({ params: NoteParams, query: GraphNeighboursQuery }),
    async (req, res) => {
      const { noteId } = input<{ noteId: string }>(req.valid.params);
      const { depth } = input<{ depth: 1 | 2 }>(req.valid.query);
      res.json(await graph.neighbours(req.auth.userId, noteId, depth));
    },
  );

  r.get('/search', validate({ query: SearchQuery }), async (req, res) => {
    res.json(await search.search(req.auth.userId, input(req.valid.query)));
  });

  return r;
}
