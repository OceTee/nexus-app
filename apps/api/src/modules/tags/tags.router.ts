import { TagCreateInput, TagMergeInput, TagParams, TagUpdateInput } from '@nexus/shared';
import { Router } from 'express';
import { input, validate } from '../../http/middleware/validate';
import type { TagsService } from './tags.service';

type P = { tagId: string };

/** `/v1/tags` (5 endpoints). Mounted behind requireAuth. */
export function tagsRouter(svc: TagsService): Router {
  const r = Router();
  const id = (req: { valid: { params?: unknown } }) => input<P>(req.valid.params).tagId;

  r.get('/', async (req, res) => {
    res.json(await svc.list(req.auth.userId));
  });

  r.post('/', validate({ body: TagCreateInput }), async (req, res) => {
    res.status(201).json(await svc.create(req.auth.userId, req.auth.deviceId, req.body));
  });

  r.patch('/:tagId', validate({ params: TagParams, body: TagUpdateInput }), async (req, res) => {
    res.json(await svc.update(req.auth.userId, req.auth.deviceId, id(req), req.body));
  });

  r.delete('/:tagId', validate({ params: TagParams }), async (req, res) => {
    await svc.remove(req.auth.userId, req.auth.deviceId, id(req));
    res.status(204).end();
  });

  r.post(
    '/:tagId/merge',
    validate({ params: TagParams, body: TagMergeInput }),
    async (req, res) => {
      res.json(await svc.merge(req.auth.userId, req.auth.deviceId, id(req), req.body.targetTagId));
    },
  );

  return r;
}
