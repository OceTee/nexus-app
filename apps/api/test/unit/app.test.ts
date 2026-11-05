import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createLogger } from '../../src/lib/logger';

const env = loadEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'https://demo.example',
});
const app = createApp({ env, logger: createLogger(env) });

describe('system routes', () => {
  it('GET /healthz returns 200 ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /v1/meta returns the API contract version', async () => {
    const res = await request(app).get('/v1/meta');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ apiVersion: '1', minClientSchema: 1, minAppVersion: '1.0.0' });
    expect(Date.parse(res.body.serverTime)).not.toBeNaN();
  });
});

describe('middleware', () => {
  it('generates a request id and echoes it in the response header', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps a well-formed incoming request id', async () => {
    const res = await request(app).get('/healthz').set('X-Request-Id', 'client-req-12345');
    expect(res.headers['x-request-id']).toBe('client-req-12345');
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows listed origins and rejects others', async () => {
    const ok = await request(app).get('/healthz').set('Origin', 'https://demo.example');
    expect(ok.headers['access-control-allow-origin']).toBe('https://demo.example');
    const bad = await request(app).get('/healthz').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error envelope', () => {
  it('returns 404 NOT_FOUND with the request id for unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: 'NOT_FOUND',
      requestId: res.headers['x-request-id'],
    });
  });

  it('returns 400 MALFORMED_JSON for an unparseable body', async () => {
    const res = await request(app)
      .post('/v1/meta')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });
});

describe('env', () => {
  it('applies defaults', () => {
    const e = loadEnv({});
    expect(e).toMatchObject({ NODE_ENV: 'development', PORT: 4000, ROLE: 'all', CORS_ORIGINS: [] });
  });

  it('rejects invalid configuration with a readable message', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/Invalid environment configuration/);
  });
});
