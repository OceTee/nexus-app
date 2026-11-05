import { Router } from 'express';
import { API_VERSION } from '@nexus/shared';
import type { ReadinessReport } from '../db/readiness';

export interface SystemRouterDeps {
  /** Readiness probe; absent when the API runs without a database (unit tests). */
  readiness?: () => Promise<ReadinessReport>;
}

/** System routes (TDD Section F, System). */
export function systemRouter({ readiness }: SystemRouterDeps = {}): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Ready when the database answers and every migration is applied.
  // The pg-boss check joins this report when background jobs arrive.
  router.get('/readyz', async (_req, res) => {
    const checks: ReadinessReport = readiness
      ? await readiness()
      : { database: false, migrations: false };
    const ready = Object.values(checks).every(Boolean);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
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
