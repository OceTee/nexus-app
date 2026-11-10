import { Decrypter, generateIdentity, identityToRecipient } from 'age-encryption';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import { SCHEDULES } from '../../src/jobs/queue';
import {
  bearer,
  closePools,
  expectError,
  makeApp,
  openPools,
  STRONG_PASSWORD,
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

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

async function uploadedAttachment(
  t: TestApp,
  u: { accessToken: string; userId: string },
  noteId: string,
) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(1)]);
  const res = await t.http
    .post('/v1/attachments')
    .set(bearer(u.accessToken))
    .send({
      id: uuidv7(),
      noteId,
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.byteLength,
      sha256: 'c'.repeat(64),
    });
  await fetch(res.body.upload.url, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  await t.http
    .post(`/v1/attachments/${res.body.attachment.id}/complete`)
    .set(bearer(u.accessToken))
    .expect(200);
  return res.body.attachment.id as string;
}

describe('schedules', () => {
  it('registers every scheduled job from the TDD table', async () => {
    const t = await makeApp(pools);
    await t.queue.schedule(SCHEDULES);
    expect(Object.fromEntries(t.queue.schedules)).toEqual({
      'backup.dump': '0 1 * * *',
      'accounts.purge': '0 2 * * *',
      'versions.prune': '0 3 * * *',
      'attachments.orphan-sweep': '30 3 * * *',
      'changes.compact': '0 4 * * 0',
      'tokens.prune': '0 5 * * *',
      'account.deletion-reminder': '0 9 * * *',
      'exports.expire': '15 * * * *',
      'audit.prune': '0 6 1 * *',
      // Not in the TDD table: the public demo account's nightly reset.
      'demo.reset': '30 5 * * *',
    });
  });
});

describe('T-27 account deletion grace', () => {
  it('keeps the account on day 29 and purges everything, R2 included, on day 31', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const noteId = (
      await t.http
        .post('/v1/notes')
        .set(bearer(u.accessToken))
        .send({ id: uuidv7(), title: 'Mine' })
    ).body.id;
    await uploadedAttachment(t, u, noteId);
    const storage = testStorage();
    expect((await storage.list(`u/${u.userId}/`)).length).toBe(1);

    await t.http
      .post('/v1/me/deletion')
      .set(bearer(u.accessToken))
      .send({ password: STRONG_PASSWORD })
      .expect(200);
    await t.drain();

    await pools.owner.db
      .update(s.users)
      .set({ deletionRequestedAt: daysAgo(29) })
      .where(eq(s.users.id, u.userId));
    await t.queue.run('accounts.purge', {});
    expect(
      await pools.owner.db.select().from(s.users).where(eq(s.users.id, u.userId)),
    ).toHaveLength(1);

    await pools.owner.db
      .update(s.users)
      .set({ deletionRequestedAt: daysAgo(31) })
      .where(eq(s.users.id, u.userId));
    await t.queue.run('accounts.purge', {});
    expect(
      await pools.owner.db.select().from(s.users).where(eq(s.users.id, u.userId)),
    ).toHaveLength(0);
    expect(await pools.owner.db.select().from(s.notes).where(eq(s.notes.id, noteId))).toHaveLength(
      0,
    );
    expect(await storage.list(`u/${u.userId}/`)).toEqual([]);

    await t.drain();
    expect(t.mail.outbox.at(-1)).toMatchObject({
      to: u.email,
      subject: 'Your NEXUS account has been deleted',
    });
    const [audit] = await pools.owner.db
      .execute(
        sql`SELECT metadata FROM audit_logs WHERE action = 'account.purged' ORDER BY id DESC LIMIT 1`,
      )
      .then((r) => r.rows as { metadata: { userHash: string } }[]);
    expect(audit!.metadata.userHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('sends the day-23 reminder by email and push', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    await pools.owner.db
      .update(s.users)
      .set({ deletionRequestedAt: daysAgo(23.2) })
      .where(eq(s.users.id, u.userId));
    t.queue.sent.length = 0;
    await t.queue.run('account.deletion-reminder', {});
    const mine = t.queue.sent.filter((j) => (j.data as { userId?: string }).userId === u.userId);
    expect(mine.map((j) => j.name).sort()).toEqual(['email.send', 'push.send']);
  });
});

describe('trash purge', () => {
  it('removes notes in Trash for 30 days, with their objects, and tells devices', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const old = (
      await t.http.post('/v1/notes').set(bearer(u.accessToken)).send({ id: uuidv7(), title: 'Old' })
    ).body.id;
    const recent = (
      await t.http
        .post('/v1/notes')
        .set(bearer(u.accessToken))
        .send({ id: uuidv7(), title: 'Recent' })
    ).body.id;
    const attachmentId = await uploadedAttachment(t, u, old);
    for (const id of [old, recent])
      await t.http
        .delete(`/v1/notes/${id}`)
        .set(bearer(u.accessToken))
        .send({ baseRev: 1 })
        .expect(204);
    await pools.owner.db
      .update(s.notes)
      .set({ deletedAt: daysAgo(31) })
      .where(eq(s.notes.id, old));

    await t.queue.run('accounts.purge', {});
    expect(await pools.owner.db.select().from(s.notes).where(eq(s.notes.id, old))).toHaveLength(0);
    expect(await pools.owner.db.select().from(s.notes).where(eq(s.notes.id, recent))).toHaveLength(
      1,
    );
    expect(
      await pools.owner.db.select().from(s.attachments).where(eq(s.attachments.id, attachmentId)),
    ).toHaveLength(0);
    expect(await testStorage().list(`u/${u.userId}/${attachmentId}/`)).toEqual([]);
    const feed = await pools.owner.db.select().from(s.changes).where(eq(s.changes.entityKey, old));
    expect(feed.at(-1)).toMatchObject({ op: 'delete' });
  });
});

describe('attachments.orphan-sweep', () => {
  it('drops stale pending uploads and removes objects of deleted attachments', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const noteId = (
      await t.http.post('/v1/notes').set(bearer(u.accessToken)).send({ id: uuidv7(), title: 'n' })
    ).body.id;
    const pending = await t.http
      .post('/v1/attachments')
      .set(bearer(u.accessToken))
      .send({
        id: uuidv7(),
        noteId,
        filename: 'never.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        sha256: 'd'.repeat(64),
      });
    await pools.owner.db
      .update(s.attachments)
      .set({ createdAt: daysAgo(2) })
      .where(eq(s.attachments.id, pending.body.attachment.id));
    const kept = await uploadedAttachment(t, u, noteId);
    const removed = await uploadedAttachment(t, u, noteId);
    await t.http.delete(`/v1/attachments/${removed}`).set(bearer(u.accessToken)).expect(204);

    await t.queue.run('attachments.orphan-sweep', {});
    expect(
      await pools.owner.db
        .select()
        .from(s.attachments)
        .where(eq(s.attachments.id, pending.body.attachment.id)),
    ).toHaveLength(0);
    const storage = testStorage();
    expect(await storage.list(`u/${u.userId}/${removed}/`)).toEqual([]);
    expect(await storage.list(`u/${u.userId}/${kept}/`)).toHaveLength(1);
  });
});

describe('changes.compact', () => {
  it('drops old feed rows and raises the horizon so stale cursors re-snapshot', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    const [old] = await pools.owner.db
      .insert(s.changes)
      .values({
        userId: u.userId,
        entityType: 'note',
        entityKey: uuidv7(),
        op: 'upsert',
        rev: 1,
        createdAt: daysAgo(100),
      })
      .returning();
    try {
      await t.queue.run('changes.compact', {});
      expect(
        await pools.owner.db
          .select()
          .from(s.changes)
          .where(eq(s.changes.changeSeq, old!.changeSeq)),
      ).toHaveLength(0);
      const [state] = await pools.owner.db.select().from(s.syncStateServer);
      expect(state!.horizonSeq).toBeGreaterThanOrEqual(old!.changeSeq);
      expectError(
        await t.http
          .post('/v1/sync')
          .set(bearer(u.accessToken))
          .send({ deviceId: u.device.id, cursor: old!.changeSeq - 1, ops: [], clientSchema: 1 }),
        409,
        'CURSOR_TOO_OLD',
      );
    } finally {
      await pools.owner.db.update(s.syncStateServer).set({ horizonSeq: 0 });
    }
  });
});

describe('tokens.prune and audit.prune', () => {
  it('removes expired tokens, old receipts and year-old audit rows only', async () => {
    const t = await makeApp(pools);
    const u = await verifiedUser(t);
    await pools.owner.db.insert(s.emailTokens).values({
      userId: u.userId,
      purpose: 'reset',
      tokenHash: `old-${uuidv7()}`,
      expiresAt: daysAgo(10),
    });
    const [oldAudit] = await pools.owner.db
      .insert(s.auditLogs)
      .values({ userId: u.userId, action: 'auth.login', createdAt: daysAgo(400) })
      .returning();
    const before = await pools.owner.db
      .select()
      .from(s.refreshTokens)
      .where(eq(s.refreshTokens.userId, u.userId));
    await pools.owner.db
      .update(s.refreshTokens)
      .set({ revokedAt: daysAgo(8) })
      .where(eq(s.refreshTokens.id, before[0]!.id));

    await t.queue.run('tokens.prune', {});
    await t.queue.run('audit.prune', {});

    const emailLeft = await pools.owner.db
      .select()
      .from(s.emailTokens)
      .where(eq(s.emailTokens.userId, u.userId));
    expect(emailLeft.every((e) => Date.parse(e.expiresAt) > Date.parse(daysAgo(7)))).toBe(true);
    const refreshLeft = await pools.owner.db
      .select()
      .from(s.refreshTokens)
      .where(eq(s.refreshTokens.userId, u.userId));
    expect(refreshLeft.map((r) => r.id)).not.toContain(before[0]!.id);
    expect(refreshLeft.length).toBe(before.length - 1);
    expect(
      await pools.owner.db.select().from(s.auditLogs).where(eq(s.auditLogs.id, oldAudit!.id)),
    ).toHaveLength(0);
    expect(
      (await pools.owner.db.select().from(s.auditLogs).where(eq(s.auditLogs.userId, u.userId)))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe('backup.dump', () => {
  it('encrypts the dump with age, uploads it and rotates dumps older than 30 days', async () => {
    const identity = await generateIdentity();
    const recipient = await identityToRecipient(identity);
    const dump = new TextEncoder().encode('PGDMP fake custom-format dump');
    const t = await makeApp(pools, { dumpDatabase: async () => dump, backupRecipient: recipient });
    const storage = testStorage();
    await storage.put(
      'backups/nexus-2020-01-01.dump.age',
      new Uint8Array([1]),
      'application/octet-stream',
    );

    await t.queue.run('backup.dump', {});

    const keys = (await storage.list('backups/')).map((o) => o.key);
    const today = `backups/nexus-${new Date().toISOString().slice(0, 10)}.dump.age`;
    expect(keys).toContain(today);
    expect(keys).not.toContain('backups/nexus-2020-01-01.dump.age');
    const encrypted = (await storage.getBytes(today))!;
    expect(new TextDecoder().decode(encrypted.slice(0, 21))).toBe('age-encryption.org/v1');
    const dec = new Decrypter();
    dec.addIdentity(identity);
    expect(await dec.decrypt(encrypted)).toEqual(dump);
  });

  it('skips cleanly when no recipient is configured', async () => {
    const t = await makeApp(pools);
    await expect(t.queue.run('backup.dump', {})).resolves.toBeUndefined();
  });
});
