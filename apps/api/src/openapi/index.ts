// Generates the OpenAPI document from a fully mounted app. Services are never
// called while routes are registered, so a stub container is enough.

import { createApp } from '../app';
import { loadEnv } from '../config/env';
import { createLogger } from '../lib/logger';
import { collectRoutes, recordMountPaths } from './collect';
import { buildOpenApiDocument } from './document';

/** A value that is any property, callable, of itself: stands in for every service. */
function stub(): never {
  const self: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === 'then' ? undefined : self),
    apply: () => self,
  });
  return self as never;
}

export function generateOpenApi(): Record<string, unknown> {
  recordMountPaths();
  // E2E_MODE stays off, so test-only routes are left out of the published spec.
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const app = createApp({ env, logger: createLogger(env), container: stub() });
  return buildOpenApiDocument(collectRoutes(app as never));
}

export { collectRoutes, recordMountPaths } from './collect';
export { RESPONSES } from './responses';
