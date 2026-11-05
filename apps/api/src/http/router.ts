import { Router } from 'express';
import { API_VERSION } from '@nexus/shared';

/** System routes (TDD Section F, System). /readyz arrives with the database in Phase 3. */
export function systemRouter(): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/v1/meta', (_req, res) => {
    res.json({
      apiVersion: API_VERSION,
      minClientSchema: 1,
      minAppVersion: '1.0.0',
      serverTime: new Date().toISOString(),
    });
  });

  return router;
}
