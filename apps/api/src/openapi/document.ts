// Builds the OpenAPI 3.1 document (TDD Section F, T-33) from the routes the
// app actually serves and the same Zod schemas that validate requests, using
// Zod 4's JSON Schema output (OpenAPI 3.1 schemas are JSON Schema 2020-12).

import { API_VERSION, ErrorEnvelope } from '@nexus/shared';
import { z } from 'zod';
import type { CollectedRoute } from './collect';
import { RESPONSES } from './responses';

type Json = Record<string, unknown>;

/** JSON Schema for a request (input side: before defaults and coercion). */
function schemaOf(schema: z.ZodType, io: 'input' | 'output'): Json {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
  }) as Json;
  return rest;
}

const openApiPath = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

function operationId(method: string, path: string): string {
  const words = path
    .replace(/^\/v1\//, '/')
    .split(/[/-]/)
    .filter(Boolean)
    .map((w) => (w.startsWith(':') ? `by ${w.slice(1)}` : w))
    .join(' ')
    .split(' ');
  return [method, ...words]
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

const tagOf = (path: string) => (path.startsWith('/v1/') ? path.split('/')[2]! : 'system');

function parameters(route: CollectedRoute): Json[] {
  const out: Json[] = [];
  for (const where of ['path', 'query'] as const) {
    const schema = where === 'path' ? route.schemas.params : route.schemas.query;
    if (!schema) continue;
    const json = schemaOf(schema, 'input');
    const props = (json.properties ?? {}) as Record<string, Json>;
    const required = new Set((json.required ?? []) as string[]);
    for (const [name, s] of Object.entries(props)) {
      out.push({ name, in: where, required: where === 'path' || required.has(name), schema: s });
    }
  }
  // Path parameters without a params schema (none today) still need declaring.
  for (const m of route.path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    if (!out.some((p) => p.in === 'path' && p.name === m[1])) {
      out.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } });
    }
  }
  return out;
}

const TAG_DESCRIPTIONS: Record<string, string> = {
  system: 'Health, readiness and API metadata.',
  auth: 'Accounts, sessions, email verification and passwords.',
  me: 'The signed-in user: profile, usage, deletion and security events.',
  devices: 'Signed-in devices and push tokens.',
  sync: 'Offline-first sync: push outbox ops, pull changes, snapshots.',
  notes: 'Notes, versions, conflicts, links and tags on a note.',
  collections: 'Nested collections (folders) of notes.',
  tags: 'Tags and tag merges.',
  attachments: 'Attachment uploads and downloads (presigned URLs).',
  exports: 'Server-side exports of the whole knowledge base.',
  graph: 'The knowledge graph of linked notes.',
  search: 'Full-text search across notes.',
};

const errorRef = { $ref: '#/components/responses/Error' };

export function buildOpenApiDocument(routes: CollectedRoute[]): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    const success = RESPONSES[key];
    if (!success) throw new Error(`No response documented for ${key} (src/openapi/responses.ts)`);

    const responses: Json = {
      [success.status]: success.schema
        ? {
            description: success.summary,
            content: { 'application/json': { schema: schemaOf(success.schema, 'output') } },
          }
        : { description: success.summary },
    };
    if (route.schemas.body || route.schemas.query || route.schemas.params)
      responses[400] = errorRef;
    if (route.requiresAuth) responses[401] = errorRef;
    responses[429] = errorRef;
    responses.default = errorRef;

    const op: Json = {
      operationId: operationId(route.method, route.path),
      summary: success.summary,
      tags: [tagOf(route.path)],
      ...(route.requiresAuth ? { security: [{ bearerAuth: [] }] } : { security: [] }),
      responses,
    };
    const params = parameters(route);
    if (params.length > 0) op.parameters = params;
    if (route.schemas.body) {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: schemaOf(route.schemas.body, 'input') } },
      };
    }
    (paths[openApiPath(route.path)] ??= {})[route.method] = op;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'NEXUS API',
      version: API_VERSION,
      description:
        'REST API for NEXUS, an offline-first knowledge base. Generated from the routes and ' +
        'Zod schemas in apps/api; do not edit by hand (pnpm --filter @nexus/api openapi).',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
    tags: [...new Set(routes.map((r) => tagOf(r.path)))].map((name) => ({
      name,
      description: TAG_DESCRIPTIONS[name] ?? name,
    })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      responses: {
        Error: {
          description: 'Error envelope (TDD Section D, Errors)',
          content: { 'application/json': { schema: schemaOf(ErrorEnvelope, 'output') } },
        },
      },
    },
  };
}
