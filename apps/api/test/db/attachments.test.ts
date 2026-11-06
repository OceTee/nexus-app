import { createHash } from 'node:crypto';
import {
  AttachmentCreatedDto,
  AttachmentDto,
  ExportJobDto,
  Paginated,
  UsageDto,
} from '@nexus/shared';
import { eq, sql } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import {
  bearer,
  closePools,
  expectError,
  expectShape,
  makeApp,
  openPools,
  testStorage,
  verifiedUser,
  type Pools,
  type TestApp,
} from '../helpers/testApp';

let pools: Pools;
beforeAll(() => {
  pools = openPools();
});
afterAll(() => closePools(pools));

type U = Awaited<ReturnType<typeof verifiedUser>>;

const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(200).fill(7),
]);
const PDF = new TextEncoder().encode(`%PDF-1.7\n${'x'.repeat(200)}`);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function note(t: TestApp, u: U, title = 'With files', bodyMd = '') {
  const res = await t.http
    .post('/v1/notes')
    .set(bearer(u.accessToken))
    .send({ id: uuidv7(), title, bodyMd });
  return res.body.id as string;
}

async function startUpload(
  t: TestApp,
  u: U,
  noteId: string,
  bytes: Uint8Array,
  mimeType: string,
  filename = 'whiteboard.png',
) {
  const res = await t.http
    .post('/v1/attachments')
    .set(bearer(u.accessToken))
    .send({
      id: uuidv7(),
      noteId,
      filename,
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256: sha(bytes),
      width: 640,
      height: 480,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return expectShape(AttachmentCreatedDto, res.body);
}

/** PUT to the presigned URL exactly as the app will (fetch computes Content-Length). */
async function put(url: string, contentType: string, bytes: Uint8Array) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

describe('T-25 attachment lifecycle', () => {
  it('creates pending, uploads to storage, completes, counts toward usage and downloads', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const noteId = await note(t, u);
    const created = await startUpload(t, u, noteId, PNG, 'image/png');
    expect(created.attachment).toMatchObject({ status: 'pending', serverRev: 1 });
    expect(created.upload).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
    });

    await put(created.upload.url, 'image/png', PNG);
    const done = await t.http
      .post(`/v1/attachments/${created.attachment.id}/complete`)
      .set(bearer(u.accessToken));
    expect(expectShape(AttachmentDto, done.body)).toMatchObject({
      status: 'uploaded',
      serverRev: 2,
    });
    // Completing again is harmless.
    expect(
      (
        await t.http
          .post(`/v1/attachments/${created.attachment.id}/complete`)
          .set(bearer(u.accessToken))
      ).body.status,
    ).toBe('uploaded');

    const usage = expectShape(
      UsageDto,
      (await t.http.get('/v1/me/usage').set(bearer(u.accessToken))).body,
    );
    expect(usage).toMatchObject({ attachments: 1, attachmentBytes: PNG.byteLength });

    const link = await t.http
      .get(`/v1/attachments/${created.attachment.id}/url`)
      .set(bearer(u.accessToken));
    const download = await fetch(link.body.url);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG);

    const list = expectShape(
      Paginated(AttachmentDto),
      (await t.http.get(`/v1/attachments?noteId=${noteId}`).set(bearer(u.accessToken))).body,
    );
    expect(list.items.map((a) => a.id)).toEqual([created.attachment.id]);

    const feed = await pools.owner.db
      .select()
      .from(s.changes)
      .where(eq(s.changes.entityKey, created.attachment.id));
    expect(feed).toHaveLength(1);
  });

  it('refuses to complete before the upload and before verification', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const created = await startUpload(t, u, await note(t, u), PNG, 'image/png');
    expectError(
      await t.http
        .post(`/v1/attachments/${created.attachment.id}/complete`)
        .set(bearer(u.accessToken)),
      409,
      'UPLOAD_INCOMPLETE',
    );
    expectError(
      await t.http.get(`/v1/attachments/${created.attachment.id}/url`).set(bearer(u.accessToken)),
      409,
      'NOT_READY',
    );
  });

  it('serves PDFs as downloads', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const created = await startUpload(
      t,
      u,
      await note(t, u),
      PDF,
      'application/pdf',
      'paper "draft".pdf',
    );
    await put(created.upload.url, 'application/pdf', PDF);
    await t.http
      .post(`/v1/attachments/${created.attachment.id}/complete`)
      .set(bearer(u.accessToken))
      .expect(200);
    const link = await t.http
      .get(`/v1/attachments/${created.attachment.id}/url`)
      .set(bearer(u.accessToken));
    const res = await fetch(link.body.url);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="paper draft.pdf"');
  });

  it('sanitises storage keys and never trusts the filename as the key', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const created = await startUpload(
      t,
      u,
      await note(t, u),
      PNG,
      'image/png',
      'Wh!teboard photo (1).png',
    );
    const [row] = await pools.owner.db
      .select()
      .from(s.attachments)
      .where(eq(s.attachments.id, created.attachment.id));
    expect(row!.storageKey).toBe(`u/${u.userId}/${created.attachment.id}/Wh_teboard_photo_1_.png`);
    expect(row!.filename).toBe('Wh!teboard photo (1).png');
  });
});

describe('T-26 attachment type mismatch', () => {
  it('rejects a PDF declared as PNG, deletes the object and the row', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const created = await startUpload(t, u, await note(t, u), PDF, 'image/png');
    await put(created.upload.url, 'image/png', PDF);
    expectError(
      await t.http
        .post(`/v1/attachments/${created.attachment.id}/complete`)
        .set(bearer(u.accessToken)),
      422,
      'TYPE_MISMATCH',
    );
    const [row] = await pools.owner.db
      .select()
      .from(s.attachments)
      .where(eq(s.attachments.id, created.attachment.id));
    expect(row!.status).toBe('deleted');
    expect(await testStorage().head(row!.storageKey)).toBeNull();
    expectError(
      await t.http.get(`/v1/attachments/${created.attachment.id}`).set(bearer(u.accessToken)),
      404,
      'NOT_FOUND',
    );
  });
});

describe('attachment guards', () => {
  it('refuses unsupported types, oversize files, quota overruns, unverified users and other people', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const noteId = await note(t, u);
    const base = { id: uuidv7(), noteId, filename: 'a.gif', sizeBytes: 10, sha256: 'a'.repeat(64) };
    expectError(
      await t.http
        .post('/v1/attachments')
        .set(bearer(u.accessToken))
        .send({ ...base, mimeType: 'image/gif' }),
      400,
      'UNSUPPORTED_TYPE',
    );
    expectError(
      await t.http
        .post('/v1/attachments')
        .set(bearer(u.accessToken))
        .send({
          ...base,
          filename: 'big.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 30 * 1024 * 1024,
        }),
      413,
      'PAYLOAD_TOO_LARGE',
    );

    // Fill the quota to 1 GB minus 100 bytes with uploaded rows.
    const fill = Array.from({ length: 41 }, (_, i) => ({
      id: uuidv7(),
      userId: u.userId,
      noteId,
      filename: `f${i}.pdf`,
      mimeType: 'application/pdf' as const,
      sizeBytes: i < 40 ? 26_214_400 : 1_073_741_824 - 40 * 26_214_400 - 100,
      storageKey: `u/${u.userId}/fill-${i}`,
      sha256: 'b'.repeat(64),
      status: 'uploaded' as const,
    }));
    await pools.owner.db.insert(s.attachments).values(fill);
    expectError(
      await t.http
        .post('/v1/attachments')
        .set(bearer(u.accessToken))
        .send({ ...base, id: uuidv7(), filename: 'x.png', mimeType: 'image/png', sizeBytes: 101 }),
      422,
      'QUOTA_EXCEEDED',
    );

    const other = await verifiedUser(t);
    expectError(
      await t.http
        .post('/v1/attachments')
        .set(bearer(other.accessToken))
        .send({ ...base, id: uuidv7(), filename: 'x.png', mimeType: 'image/png' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await t.http.get(`/v1/attachments/${fill[0]!.id}`).set(bearer(other.accessToken)),
      404,
      'NOT_FOUND',
    );
  });

  it('deletes an uploaded attachment through the op engine (feed delete)', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const created = await startUpload(t, u, await note(t, u), PNG, 'image/png');
    await put(created.upload.url, 'image/png', PNG);
    await t.http
      .post(`/v1/attachments/${created.attachment.id}/complete`)
      .set(bearer(u.accessToken))
      .expect(200);
    await t.http
      .delete(`/v1/attachments/${created.attachment.id}`)
      .set(bearer(u.accessToken))
      .expect(204);
    const ops = await pools.owner.db
      .select({ op: s.changes.op })
      .from(s.changes)
      .where(eq(s.changes.entityKey, created.attachment.id));
    expect(ops.map((o) => o.op)).toEqual(['upsert', 'delete']);
  });
});

describe('server-side exports (feature flag)', () => {
  it('answers 503 FEATURE_DISABLED while the flag is off', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    expectError(
      await t.http.post('/v1/exports').set(bearer(u.accessToken)).send({ format: 'json' }),
      503,
      'FEATURE_DISABLED',
    );
  });

  it('builds a Markdown bundle with notes and attachments when enabled', async () => {
    const t = await makeApp(pools, { serverExports: true });
    const u = await verifiedUser(t);
    const noteId = await note(t, u, 'Kalman filtering', 'See [[State estimation]].');
    await note(t, u, 'State estimation', 'Hidden state.');
    const created = await startUpload(t, u, noteId, PNG, 'image/png');
    await put(created.upload.url, 'image/png', PNG);
    await t.http
      .post(`/v1/attachments/${created.attachment.id}/complete`)
      .set(bearer(u.accessToken))
      .expect(200);

    const job = expectShape(
      ExportJobDto,
      (await t.http.post('/v1/exports').set(bearer(u.accessToken)).send({ format: 'markdown_zip' }))
        .body,
    );
    expect(job.status).toBe('queued');
    expectError(
      await t.http.get(`/v1/exports/${job.id}/download`).set(bearer(u.accessToken)),
      409,
      'NOT_READY',
    );

    await t.drain();
    const ready = await t.http.get(`/v1/exports/${job.id}`).set(bearer(u.accessToken));
    expect(ready.body.status).toBe('ready');
    const link = await t.http.get(`/v1/exports/${job.id}/download`).set(bearer(u.accessToken));
    const zip = unzipSync(new Uint8Array(await (await fetch(link.body.url)).arrayBuffer()));
    const names = Object.keys(zip).sort();
    expect(names).toContain('notes/Kalman_filtering.md');
    expect(names).toContain(`attachments/${created.attachment.id}/whiteboard.png`);
    const md = new TextDecoder().decode(zip['notes/Kalman_filtering.md']);
    expect(md).toMatch(/^---\nid: [0-9a-f-]{36}\ntitle: Kalman filtering\n/);
    expect(md).toContain('links:\n  - State estimation');
    expect(md.endsWith('See [[State estimation]].\n')).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(zip['index.json'])).notes[noteId]).toBe(
      'notes/Kalman_filtering.md',
    );
  });

  it('expires ready exports after their date (exports.expire)', async () => {
    const t = await makeApp(pools, { serverExports: true });
    const u = await verifiedUser(t);
    await note(t, u, 'One');
    const job = (
      await t.http.post('/v1/exports').set(bearer(u.accessToken)).send({ format: 'json' })
    ).body;
    await t.drain();
    await pools.owner.db.execute(
      sql`UPDATE export_jobs SET expires_at = now() - interval '1 minute' WHERE id = ${job.id}`,
    );
    await t.queue.run('exports.expire', {});
    expectError(
      await t.http.get(`/v1/exports/${job.id}/download`).set(bearer(u.accessToken)),
      410,
      'EXPIRED',
    );
  });
});
