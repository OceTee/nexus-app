// Generates a Bruno collection (docs/api/bruno) from docs/api/openapi.json.
//
//   node scripts/openapi-to-bruno.mjs
//
// One .bru request per operation, in one folder per tag. Protected routes use
// bearer auth with {{accessToken}}; sign-in, sign-up and refresh store the new
// tokens in the active environment. Request bodies are examples built from the
// schemas: required fields plus a note's title and body (every field when none
// is required). The output folder is rewritten on every run except README.md,
// so edit this script rather than the generated files.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(root, 'docs/api/openapi.json'), 'utf8'));
const outDir = join(root, 'docs/api/bruno');

const ENVIRONMENTS = {
  local: 'http://localhost:4000',
  hosted: 'https://nexus-api-hv8l.onrender.com',
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const EXAMPLE_UUID = '01900000-0000-7000-8000-000000000001';
const EXAMPLE_TIME = '2026-01-01T09:00:00.000Z';
const SHOWCASE = new Set(['title', 'bodyMd']);
const TOKEN_ROUTES = new Set(['postAuthLogin', 'postAuthRegister', 'postAuthRefresh']);

// ---------- example values ----------

/** Example for a string field, chosen by its name first and its schema second. */
function exampleString(name, schema) {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum.includes('android') ? 'android' : schema.enum[0];
  const byName = {
    email: '{{email}}',
    password: '{{password}}',
    currentPassword: '{{password}}',
    newPassword: 'a-new-long-password',
    refreshToken: '{{refreshToken}}',
    deviceId: '{{deviceId}}',
    opId: '01900000-0000-7000-8000-0000000000aa',
    q: 'kalman',
    cursor: '',
    token: 'token-from-the-email-link',
    displayName: 'Demo',
    appVersion: '1.0.1',
    name: 'Bruno',
    title: 'Hello from Bruno',
    bodyMd: 'Written from the API client. See [[Another note]].',
    filename: 'whiteboard.jpg',
    sha256: '0'.repeat(64),
    colour: '#3366FF',
    icon: 'book',
  };
  if (name in byName) return byName[name];
  if (schema.default !== undefined) return schema.default;
  if (schema.format === 'uuid') return EXAMPLE_UUID;
  if (schema.format === 'date-time') return EXAMPLE_TIME;
  return 'string';
}

/** Builds an example value for `schema`, or undefined when it is not simple. */
function example(schema, name = '', depth = 0) {
  if (!schema || depth > 6) return undefined;
  if (schema.const !== undefined) return schema.const;
  if (schema.default === null) return null;
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives) {
    const first = alternatives.find((s) => s.type !== 'null') ?? alternatives[0];
    return example(first, name, depth + 1);
  }
  switch (schema.type) {
    case 'object': {
      const props = schema.properties ?? {};
      // Required fields, plus a note's title and body so the example says something.
      const keys = schema.required?.length
        ? Object.keys(props).filter((k) => schema.required.includes(k) || SHOWCASE.has(k))
        : Object.keys(props);
      const out = {};
      for (const key of keys) {
        // A device object inside sign-in or sign-up uses the environment's device id.
        const child = name === 'device' && key === 'id' ? '{{deviceId}}' : undefined;
        const value = child ?? example(props[key], key, depth + 1);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    case 'array': {
      const item = schema.items;
      // Ids in an example list would point at rows that don't exist.
      if (!item || !(item.type === 'object' || item.oneOf || item.anyOf)) return [];
      const value = example(item, name, depth + 1);
      return value === undefined ? [] : [value];
    }
    case 'string':
      return exampleString(name, schema);
    case 'integer':
    case 'number':
      if (schema.default !== undefined) return schema.default;
      if (name === 'cursor' || name === 'sortOrder') return 0;
      if (name === 'clientSchema') return 1;
      return schema.minimum ?? 1;
    case 'boolean':
      return schema.default ?? false;
    default:
      return undefined;
  }
}

/** Example for a query or path parameter. */
function paramExample(param) {
  const value = example(param.schema ?? {}, param.name);
  return value === undefined || typeof value === 'object' ? '' : String(value);
}

// ---------- .bru output ----------

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const indent = (text, spaces = 2) =>
  text
    .split('\n')
    .map((line) => (line ? ' '.repeat(spaces) + line : line))
    .join('\n');

const block = (name, lines) => `${name} {\n${indent(lines.join('\n'))}\n}\n`;

function requestFile(path, method, op, seq) {
  const protectedRoute = (op.security ?? spec.security ?? []).some((s) => 'bearerAuth' in s);
  const params = op.parameters ?? [];
  const query = params.filter((p) => p.in === 'query');
  const pathParams = params.filter((p) => p.in === 'path');
  const schema = op.requestBody?.content?.['application/json']?.schema;
  const body = schema ? example(schema) : undefined;

  // Bruno writes path parameters as :name; required query parameters go in the URL.
  const urlPath = path.replace(/\{(\w+)\}/g, ':$1');
  const requiredQuery = query.filter((p) => p.required).map((p) => `${p.name}=${paramExample(p)}`);
  const url = `{{baseUrl}}${urlPath}${requiredQuery.length ? `?${requiredQuery.join('&')}` : ''}`;

  const parts = [
    block('meta', [`name: ${op.summary ?? op.operationId}`, 'type: http', `seq: ${seq}`]),
    block(method, [
      `url: ${url}`,
      `body: ${body === undefined ? 'none' : 'json'}`,
      `auth: ${protectedRoute ? 'bearer' : 'none'}`,
    ]),
  ];
  if (query.length) {
    // Optional parameters are listed but disabled (~) until you need them.
    parts.push(
      block(
        'params:query',
        query.map((p) => `${p.required ? '' : '~'}${p.name}: ${paramExample(p)}`),
      ),
    );
  }
  if (pathParams.length) {
    parts.push(
      block(
        'params:path',
        pathParams.map((p) => `${p.name}: ${EXAMPLE_UUID}`),
      ),
    );
  }
  if (protectedRoute) parts.push(block('auth:bearer', ['token: {{accessToken}}']));
  if (body !== undefined) parts.push(block('body:json', JSON.stringify(body, null, 2).split('\n')));
  if (TOKEN_ROUTES.has(op.operationId)) {
    parts.push(
      block('script:post-response', [
        'if (res.status < 300) {',
        '  bru.setEnvVar("accessToken", res.body.accessToken);',
        '  bru.setEnvVar("refreshToken", res.body.refreshToken);',
        '}',
      ]),
    );
  }
  const codes = Object.keys(op.responses ?? {}).join(', ');
  const docs = [
    `${method.toUpperCase()} ${path} (operationId: ${op.operationId})`,
    ...(op.description ? ['', op.description] : []),
    '',
    `Responses: ${codes}`,
  ];
  parts.push(block('docs', docs));
  return parts.join('\n');
}

function environmentFile(baseUrl) {
  return [
    block('vars', [
      `baseUrl: ${baseUrl}`,
      'email: demo@nexus.example',
      `deviceId: ${EXAMPLE_UUID}`,
    ]),
    // Secrets stay on your machine; Bruno never writes their values to this file.
    'vars:secret [\n  password,\n  accessToken,\n  refreshToken\n]\n',
  ].join('\n');
}

// ---------- write ----------

mkdirSync(outDir, { recursive: true });
for (const entry of readdirSync(outDir, { withFileTypes: true })) {
  if (entry.name === 'README.md') continue;
  rmSync(join(outDir, entry.name), { recursive: true, force: true });
}

// Laid out the way Prettier formats it, so `pnpm format:check` passes after a regenerate.
const brunoJson = JSON.stringify(
  {
    version: '1',
    name: spec.info?.title ?? 'NEXUS API',
    type: 'collection',
    ignore: ['node_modules', '.git'],
  },
  null,
  2,
).replace(/\[\s+([^\]]*?)\s+\]/g, (_, items) => `[${items.split(/,\s+/).join(', ')}]`);
writeFileSync(join(outDir, 'bruno.json'), `${brunoJson}\n`);

mkdirSync(join(outDir, 'environments'), { recursive: true });
for (const [name, baseUrl] of Object.entries(ENVIRONMENTS)) {
  writeFileSync(join(outDir, 'environments', `${name}.bru`), environmentFile(baseUrl));
}

const folders = new Map(); // tag -> { seq, count, names }
let written = 0;
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const tag = op.tags?.[0] ?? 'other';
    if (!folders.has(tag)) {
      folders.set(tag, { seq: folders.size + 1, count: 0, names: new Set() });
      mkdirSync(join(outDir, tag), { recursive: true });
      writeFileSync(
        join(outDir, tag, 'folder.bru'),
        block('meta', [`name: ${tag}`, `seq: ${folders.size}`]),
      );
    }
    const folder = folders.get(tag);
    folder.count += 1;
    let file = slug(op.summary ?? op.operationId);
    if (folder.names.has(file)) file = slug(op.operationId);
    folder.names.add(file);
    writeFileSync(join(outDir, tag, `${file}.bru`), requestFile(path, method, op, folder.count));
    written += 1;
  }
}

console.log(`Wrote ${written} requests in ${folders.size} folders to ${outDir}`);
