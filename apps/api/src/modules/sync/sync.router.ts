import { SnapshotQuery, SyncPushRequest } from '@nexus/shared';
import { Router } from 'express';
import { requireVerified } from '../../http/middleware/auth';
import { consume, type Limiters } from '../../http/middleware/rateLimit';
import { input, validate } from '../../http/middleware/validate';
import type { SyncService } from './sync.service';

/** `/v1/sync` (3 endpoints). Mounted behind requireAuth; push and snapshot need a verified email. */
export function syncRouter(svc: SyncService, limiters: Limiters): Router {
  const r = Router();

  r.post('/', requireVerified, validate({ body: SyncPushRequest }), async (req, res) => {
    await consume(limiters.sync, `device:${req.auth.deviceId}`, res);
    res.json(await svc.sync(req.auth.userId, req.auth.deviceId, req.body));
  });

  r.get('/snapshot', requireVerified, validate({ query: SnapshotQuery }), async (req, res) => {
    const q = input<{ cursor?: string; limit: number }>(req.valid.query);
    res.json(await svc.snapshot(req.auth.userId, q.cursor, q.limit));
  });

  r.get('/status', async (req, res) => {
    res.json(await svc.status(req.auth.userId));
  });

  return r;
}
