import { AuditListQuery, DeletionRequestInput, UpdateMeInput, type PageQuery } from '@nexus/shared';
import { Router } from 'express';
import { requestContext } from '../../http/context';
import { input, validate } from '../../http/middleware/validate';
import type { AccountService } from './account.service';

/** `/v1/me/*` (6 endpoints; TDD Section F, Account). Mounted behind requireAuth. */
export function accountRouter(svc: AccountService): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json(await svc.me(req.auth.userId));
  });

  r.patch('/', validate({ body: UpdateMeInput }), async (req, res) => {
    res.json(await svc.update(req.auth.userId, req.body));
  });

  r.get('/usage', async (req, res) => {
    res.json(await svc.usage(req.auth.userId));
  });

  r.post('/deletion', validate({ body: DeletionRequestInput }), async (req, res) => {
    res.json(await svc.requestDeletion(req.auth.userId, req.body.password, requestContext(req)));
  });

  r.delete('/deletion', async (req, res) => {
    await svc.cancelDeletion(req.auth.userId, requestContext(req));
    res.status(204).end();
  });

  r.get('/audit', validate({ query: AuditListQuery }), async (req, res) => {
    const q = input<PageQuery>(req.valid.query);
    res.json(await svc.auditEvents(req.auth.userId, q.cursor, q.limit));
  });

  return r;
}
