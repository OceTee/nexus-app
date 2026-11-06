import { ExportCreateInput, ExportParams } from '@nexus/shared';
import { Router } from 'express';
import { requireVerified } from '../../http/middleware/auth';
import { consume, type Limiters } from '../../http/middleware/rateLimit';
import { input, validate } from '../../http/middleware/validate';
import type { ExportsService } from './exports.service';

type P = { exportId: string };

/** `/v1/exports` (4 endpoints, post-MVP; POST answers 503 while the flag is off). */
export function exportsRouter(svc: ExportsService, limiters: Limiters): Router {
  const r = Router();
  const id = (req: { valid: { params?: unknown } }) => input<P>(req.valid.params).exportId;

  r.post('/', requireVerified, validate({ body: ExportCreateInput }), async (req, res) => {
    await consume(limiters.exports, `user:${req.auth.userId}`, res);
    res.status(202).json(await svc.create(req.auth.userId, req.body));
  });

  r.get('/', async (req, res) => {
    res.json(await svc.list(req.auth.userId));
  });

  r.get('/:exportId', validate({ params: ExportParams }), async (req, res) => {
    res.json(await svc.get(req.auth.userId, id(req)));
  });

  r.get('/:exportId/download', validate({ params: ExportParams }), async (req, res) => {
    res.json(await svc.downloadUrl(req.auth.userId, id(req)));
  });

  return r;
}
