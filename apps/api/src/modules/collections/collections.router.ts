import {
  BaseRevInput,
  CollectionCreateInput,
  CollectionMoveInput,
  CollectionParams,
  CollectionUpdateInput,
} from '@nexus/shared';
import { Router } from 'express';
import { input, validate } from '../../http/middleware/validate';
import type { CollectionsService } from './collections.service';

type P = { collectionId: string };

/** `/v1/collections` (6 endpoints). Mounted behind requireAuth. */
export function collectionsRouter(svc: CollectionsService): Router {
  const r = Router();
  const id = (req: { valid: { params?: unknown } }) => input<P>(req.valid.params).collectionId;

  r.get('/', async (req, res) => {
    res.json(await svc.list(req.auth.userId));
  });

  r.post('/', validate({ body: CollectionCreateInput }), async (req, res) => {
    res.status(201).json(await svc.create(req.auth.userId, req.auth.deviceId, req.body));
  });

  r.get('/:collectionId', validate({ params: CollectionParams }), async (req, res) => {
    res.json(await svc.get(req.auth.userId, id(req)));
  });

  r.patch(
    '/:collectionId',
    validate({ params: CollectionParams, body: CollectionUpdateInput }),
    async (req, res) => {
      res.json(await svc.update(req.auth.userId, req.auth.deviceId, id(req), req.body));
    },
  );

  r.delete(
    '/:collectionId',
    validate({ params: CollectionParams, body: BaseRevInput }),
    async (req, res) => {
      await svc.remove(req.auth.userId, req.auth.deviceId, id(req), req.body.baseRev);
      res.status(204).end();
    },
  );

  r.post(
    '/:collectionId/move',
    validate({ params: CollectionParams, body: CollectionMoveInput }),
    async (req, res) => {
      res.json(await svc.move(req.auth.userId, req.auth.deviceId, id(req), req.body));
    },
  );

  return r;
}
