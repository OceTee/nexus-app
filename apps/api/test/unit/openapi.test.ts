import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateOpenApi, RESPONSES } from '../../src/openapi';

// T-33: the published spec is generated from the served routes and their
// Zod schemas, and must be regenerated whenever either changes.
const doc = generateOpenApi() as {
  paths: Record<string, Record<string, { security: unknown[]; parameters?: unknown[] }>>;
};
const ops = Object.entries(doc.paths).flatMap(([path, methods]) =>
  Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`),
);

describe('OpenAPI document', () => {
  it('documents every /v1 endpoint the TDD lists (62 or more)', () => {
    expect(ops.filter((o) => o.includes(' /v1/')).length).toBeGreaterThanOrEqual(62);
  });

  it('has a response entry for exactly the routes the app serves', () => {
    const served = ops.map((o) => o.replace(/\{([^}]+)\}/g, ':$1')).sort();
    expect(Object.keys(RESPONSES).sort()).toEqual(served);
  });

  it('marks protected routes with bearer auth and public ones without', () => {
    expect(doc.paths['/v1/notes']!.get!.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/v1/auth/login']!.post!.security).toEqual([]);
    expect(doc.paths['/v1/auth/logout']!.post!.security).toEqual([{ bearerAuth: [] }]);
  });

  it('leaves out E2E-only routes', () => {
    expect(Object.keys(doc.paths).some((p) => p.startsWith('/v1/dev/'))).toBe(false);
  });

  it('matches docs/api/openapi.json (run `pnpm --filter @nexus/api openapi` after route changes)', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../../../../docs/api/openapi.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});
