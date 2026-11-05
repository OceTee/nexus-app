import { normaliseTitle } from '@nexus/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createDb, type DbHandle } from '../../src/db/client';
import { expectedMigrationCount, runMigrations } from '../../src/db/migrate';
import * as s from '../../src/db/schema';
import { withUser } from '../../src/db/withUser';
import { createLogger } from '../../src/lib/logger';
import { makeCollection, makeDevice, makeNote, makeTag, makeUser } from '../fixtures/factories';

let owner: DbHandle;
let api: DbHandle;

beforeAll(() => {
  owner = createDb(inject('ownerUrl'), { max: 4 });
  api = createDb(inject('apiUrl'), { max: 4 });
});

afterAll(async () => {
  await owner.close();
  await api.close();
});

/** Asserts that a write fails on the named constraint (Drizzle keeps the pg error as `cause`). */
async function expectViolation(write: Promise<unknown>, constraint: string): Promise<void> {
  const err = await write.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, `expected a ${constraint} violation`).toBeInstanceOf(Error);
  const cause = (err as { cause?: { constraint?: string } }).cause;
  expect(cause?.constraint).toBe(constraint);
}

/** Rows of a raw query as plain objects. */
async function rows<T>(handle: DbHandle, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await handle.db.execute(query)).rows as T[];
}

describe('T-34 migrations', () => {
  it('apply from zero and re-run as a no-op', async () => {
    const before = await rows<{ n: number }>(
      owner,
      sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(before[0]!.n).toBe(expectedMigrationCount());

    await runMigrations(inject('ownerUrl'));

    const after = await rows<{ n: number }>(
      owner,
      sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('create all 15 application tables with RLS on every user-owned one', async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(
      owner,
      sql`SELECT c.relname, c.relrowsecurity FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    const names = tables.map((t) => t.relname);
    for (const t of [
      'users',
      'email_tokens',
      'devices',
      'refresh_tokens',
      'collections',
      'notes',
      'note_versions',
      'tags',
      'note_tags',
      'note_links',
      'attachments',
      'changes',
      'op_receipts',
      'export_jobs',
      'audit_logs',
    ]) {
      expect(names, t).toContain(t);
    }
    const withoutRls = tables
      .filter((t) => !t.relrowsecurity)
      .map((t) => t.relname)
      .sort();
    // Token tables are looked up before a user context exists; sync_state_server is global.
    expect(withoutRls).toEqual([
      'email_tokens',
      'rate_limits',
      'refresh_tokens',
      'sync_state_server',
    ]);
  });

  it('give nexus_api no BYPASSRLS and no table ownership', async () => {
    const [role] = await rows<{ rolbypassrls: boolean; rolsuper: boolean }>(
      owner,
      sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'nexus_api'`,
    );
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
    const owned = await rows(
      owner,
      sql`SELECT tablename FROM pg_tables WHERE tableowner = 'nexus_api'`,
    );
    expect(owned).toEqual([]);
  });
});

describe('T-21 row-level security', () => {
  it('returns zero rows from every user-owned table without a user context', async () => {
    const user = await makeUser(owner.db);
    const device = await makeDevice(owner.db, user.id);
    const note = await makeNote(owner.db, user.id);
    const tag = await makeTag(owner.db, user.id);
    await owner.db.insert(s.noteTags).values({ noteId: note.id, tagId: tag.id, userId: user.id });
    await owner.db.insert(s.changes).values({
      userId: user.id,
      entityType: 'note',
      entityId: note.id,
      entityKey: note.id,
      op: 'upsert',
      rev: 1,
    });
    await owner.db
      .insert(s.opReceipts)
      .values({ opId: uuidv7(), userId: user.id, deviceId: device.id, status: 'applied' });

    for (const table of [
      'users',
      'devices',
      'collections',
      'notes',
      'note_versions',
      'tags',
      'note_tags',
      'note_links',
      'attachments',
      'export_jobs',
      'audit_logs',
      'changes',
      'op_receipts',
    ]) {
      const result = await rows<{ n: number }>(
        api,
        sql.raw(`SELECT count(*)::int AS n FROM ${table}`),
      );
      expect(result[0]!.n, table).toBe(0);
    }
  });

  it('shows a user only their own rows inside withUser', async () => {
    const alice = await makeUser(owner.db);
    const bob = await makeUser(owner.db);
    const aliceNote = await makeNote(owner.db, alice.id, { title: 'Alice private' });
    await makeNote(owner.db, bob.id, { title: 'Bob private' });

    const seen = await withUser(api.db, alice.id, (tx) => tx.select().from(s.notes));
    expect(seen.map((n) => n.id)).toEqual([aliceNote.id]);
  });

  it('rejects writes for another user (WITH CHECK)', async () => {
    const alice = await makeUser(owner.db);
    const bob = await makeUser(owner.db);
    await expect(
      withUser(api.db, alice.id, (tx) =>
        tx.insert(s.notes).values({ id: uuidv7(), userId: bob.id, title: 'forged' }),
      ),
    ).rejects.toThrow();
  });

  it('does not leak the user context to the next transaction on the pool', async () => {
    const alice = await makeUser(owner.db);
    await makeNote(owner.db, alice.id);
    await withUser(api.db, alice.id, (tx) => tx.select().from(s.notes));
    const after = await rows<{ n: number }>(api, sql`SELECT count(*)::int AS n FROM notes`);
    expect(after[0]!.n).toBe(0);
  });

  it('rejects a non-UUID user id before touching the database', async () => {
    await expect(withUser(api.db, "x'; DROP TABLE notes; --", async () => 1)).rejects.toThrow(
      TypeError,
    );
  });
});

describe('T-35 updated_at trigger', () => {
  it('changes updated_at but not created_at on update', async () => {
    const user = await makeUser(owner.db);
    const note = await makeNote(owner.db, user.id, { title: 'Before' });
    await new Promise((r) => setTimeout(r, 20));
    const [updated] = await owner.db
      .update(s.notes)
      .set({ title: 'After' })
      .where(eq(s.notes.id, note.id))
      .returning();
    expect(updated!.createdAt).toBe(note.createdAt);
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse(note.updatedAt));
  });
});

describe('T-36 unique tag per user', () => {
  it('rejects Thesis and thesis for one user but allows them for different users', async () => {
    const amara = await makeUser(owner.db);
    const tunde = await makeUser(owner.db);
    await makeTag(owner.db, amara.id, 'Thesis');
    await expectViolation(makeTag(owner.db, amara.id, 'thesis'), 'tags_user_name_uq');
    await expect(makeTag(owner.db, tunde.id, 'thesis')).resolves.toBeTruthy();
  });

  it('allows reusing a name after the old tag is deleted (tombstoned)', async () => {
    const user = await makeUser(owner.db);
    const old = await makeTag(owner.db, user.id, 'Reading');
    await owner.db
      .update(s.tags)
      .set({ deletedAt: sql`now()` })
      .where(eq(s.tags.id, old.id));
    await expect(makeTag(owner.db, user.id, 'reading')).resolves.toBeTruthy();
  });
});

describe('T-37 generated columns', () => {
  it('normalises the title and indexes it for search', async () => {
    const user = await makeUser(owner.db);
    const note = await makeNote(owner.db, user.id, {
      title: '  Kalman ',
      bodyText: 'state estimation',
    });
    expect(note.titleNorm).toBe('kalman');
    const [hit] = await rows<{ hit: boolean }>(
      owner,
      sql`SELECT search_tsv @@ to_tsquery('english', 'kalman & estimation') AS hit FROM notes WHERE id = ${note.id}`,
    );
    expect(hit!.hit).toBe(true);
  });

  it('matches normaliseTitle from @nexus/shared', async () => {
    const user = await makeUser(owner.db);
    for (const title of ['  Kalman  Filtering ', 'Café Notes', 'Tabs\tand\nNewlines', 'ÉCOLE']) {
      const note = await makeNote(owner.db, user.id, { title });
      expect(note.titleNorm, JSON.stringify(title)).toBe(normaliseTitle(title));
    }
  });
});

describe('ghost links (BR-06)', () => {
  it('resolve when a note with the matching title is created', async () => {
    const user = await makeUser(owner.db);
    const source = await makeNote(owner.db, user.id, { title: 'Source' });
    await owner.db.insert(s.noteLinks).values({
      sourceNoteId: source.id,
      userId: user.id,
      targetTitleNorm: normaliseTitle('State  Estimation'),
    });
    const target = await makeNote(owner.db, user.id, { title: 'State Estimation' });
    const [link] = await owner.db
      .select()
      .from(s.noteLinks)
      .where(eq(s.noteLinks.sourceNoteId, source.id));
    expect(link!.targetNoteId).toBe(target.id);
  });

  it('resolve when a note is renamed to the matching title', async () => {
    const user = await makeUser(owner.db);
    const source = await makeNote(owner.db, user.id);
    const later = await makeNote(owner.db, user.id, { title: 'Draft' });
    await owner.db
      .insert(s.noteLinks)
      .values({ sourceNoteId: source.id, userId: user.id, targetTitleNorm: 'sensor fusion' });
    await owner.db.update(s.notes).set({ title: 'Sensor Fusion' }).where(eq(s.notes.id, later.id));
    const [link] = await owner.db
      .select()
      .from(s.noteLinks)
      .where(eq(s.noteLinks.sourceNoteId, source.id));
    expect(link!.targetNoteId).toBe(later.id);
  });

  it('do not resolve to another user’s note', async () => {
    const alice = await makeUser(owner.db);
    const bob = await makeUser(owner.db);
    const source = await makeNote(owner.db, alice.id);
    await owner.db
      .insert(s.noteLinks)
      .values({ sourceNoteId: source.id, userId: alice.id, targetTitleNorm: 'bob only' });
    await makeNote(owner.db, bob.id, { title: 'Bob Only' });
    const [link] = await owner.db
      .select()
      .from(s.noteLinks)
      .where(eq(s.noteLinks.sourceNoteId, source.id));
    expect(link!.targetNoteId).toBeNull();
  });
});

describe('constraints', () => {
  it('reject a collection that is its own parent and invalid tag names', async () => {
    const user = await makeUser(owner.db);
    const id = uuidv7();
    await expectViolation(
      owner.db.insert(s.collections).values({ id, userId: user.id, parentId: id, name: 'Loop' }),
      'collections_not_self',
    );
    await expectViolation(makeTag(owner.db, user.id, 'two words'), 'tags_name_format');
  });

  it('reject unsupported attachment types', async () => {
    const user = await makeUser(owner.db);
    await expectViolation(
      owner.db.insert(s.attachments).values({
        id: uuidv7(),
        userId: user.id,
        filename: 'a.gif',
        mimeType: 'image/gif' as 'image/png',
        sizeBytes: 10,
        storageKey: `k-${uuidv7()}`,
        sha256: 'a'.repeat(64),
      }),
      'attachments_mime_type',
    );
  });
});

describe('T-38 cascade on user delete', () => {
  it('removes every owned row and keeps audit rows without the user', async () => {
    const user = await makeUser(owner.db);
    const device = await makeDevice(owner.db, user.id);
    const collection = await makeCollection(owner.db, user.id);
    const note = await makeNote(owner.db, user.id, { collectionId: collection.id });
    const tag = await makeTag(owner.db, user.id);
    const u = user.id;
    await owner.db.insert(s.noteTags).values({ noteId: note.id, tagId: tag.id, userId: u });
    await owner.db
      .insert(s.noteLinks)
      .values({ sourceNoteId: note.id, userId: u, targetTitleNorm: 'x' });
    await owner.db
      .insert(s.noteVersions)
      .values({ noteId: note.id, userId: u, rev: 1, title: 't', bodyMd: 'b' });
    await owner.db.insert(s.attachments).values({
      id: uuidv7(),
      userId: u,
      noteId: note.id,
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      storageKey: `k-${uuidv7()}`,
      sha256: 'b'.repeat(64),
    });
    await owner.db.insert(s.emailTokens).values({
      userId: u,
      purpose: 'verify',
      tokenHash: `h-${uuidv7()}`,
      expiresAt: '2030-01-01T00:00:00Z',
    });
    await owner.db.insert(s.refreshTokens).values({
      userId: u,
      deviceId: device.id,
      familyId: uuidv7(),
      tokenHash: `r-${uuidv7()}`,
      expiresAt: '2030-01-01T00:00:00Z',
    });
    await owner.db.insert(s.exportJobs).values({ userId: u, format: 'json' });
    await owner.db.insert(s.changes).values({
      userId: u,
      entityType: 'note',
      entityId: note.id,
      entityKey: note.id,
      op: 'upsert',
      rev: 1,
    });
    await owner.db
      .insert(s.opReceipts)
      .values({ opId: uuidv7(), userId: u, deviceId: device.id, status: 'applied' });
    const [audit] = await owner.db
      .insert(s.auditLogs)
      .values({ userId: u, action: 'auth.login' })
      .returning();

    await owner.db.delete(s.users).where(eq(s.users.id, u));

    for (const table of [
      'devices',
      'collections',
      'notes',
      'note_versions',
      'tags',
      'note_tags',
      'note_links',
      'attachments',
      'email_tokens',
      'refresh_tokens',
      'export_jobs',
      'changes',
      'op_receipts',
    ]) {
      const result = await rows<{ n: number }>(
        owner,
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE user_id = ${u}`,
      );
      expect(result[0]!.n, table).toBe(0);
    }
    const [kept] = await owner.db.select().from(s.auditLogs).where(eq(s.auditLogs.id, audit!.id));
    expect(kept!.userId).toBeNull();
  });
});

describe('T-39 index usage', () => {
  let user: Awaited<ReturnType<typeof makeUser>>;

  let midSeq = 0;

  // A realistic shape (20 users, 1,000 notes and changes each, interleaved as
  // concurrent users produce them) with fresh statistics, so the planner picks
  // indexes on its own, as it would in production where one user owns a tiny
  // fraction of the feed.
  beforeAll(async () => {
    const users = await Promise.all(Array.from({ length: 20 }, () => makeUser(owner.db)));
    user = users[0]!;
    const ids = sql.join(
      users.map((u) => sql`${u.id}::uuid`),
      sql`, `,
    );
    await owner.db.execute(sql`
      INSERT INTO notes (id, user_id, title, updated_at)
      SELECT gen_random_uuid(), u, 'Note ' || g, now() - g * interval '1 minute'
      FROM generate_series(1, 1000) g CROSS JOIN unnest(ARRAY[${ids}]) u`);
    await owner.db.execute(sql`
      INSERT INTO changes (user_id, entity_type, entity_key, op, rev)
      SELECT u, 'note', gen_random_uuid()::text, 'upsert', 1
      FROM generate_series(1, 1000) g CROSS JOIN unnest(ARRAY[${ids}]) u
      ORDER BY g`);
    const [mid] = await rows<{ seq: number }>(
      owner,
      sql`SELECT (min(change_seq) + (max(change_seq) - min(change_seq)) / 2)::int AS seq
          FROM changes WHERE user_id = ${user.id}`,
    );
    midSeq = mid!.seq;
    await owner.db.execute(sql`ANALYZE notes`);
    await owner.db.execute(sql`ANALYZE changes`);
  });

  async function plan(query: ReturnType<typeof sql>): Promise<string> {
    const result = await owner.db.execute(sql`EXPLAIN ${query}`);
    return (result.rows as { 'QUERY PLAN': string }[]).map((r) => r['QUERY PLAN']).join('\n');
  }

  it('uses notes_user_updated_idx for the notes list', async () => {
    const text = await plan(
      sql`SELECT id, title FROM notes WHERE user_id = ${user.id} AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50`,
    );
    expect(text).toContain('notes_user_updated_idx');
  });

  it('uses changes_user_seq_idx for the change feed', async () => {
    const text = await plan(
      sql`SELECT * FROM changes WHERE user_id = ${user.id} AND change_seq > ${midSeq} ORDER BY change_seq LIMIT 500`,
    );
    expect(text).toContain('changes_user_seq_idx');
  });
});

describe('GET /readyz', () => {
  it('reports ready with a migrated database, as the API role', async () => {
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
    const app = createApp({ env, logger: createLogger(env), db: api.db });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: true, migrations: true } });
  });

  it('reports not ready when the database is unreachable', async () => {
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
    const broken = createDb('postgres://nobody:wrong@127.0.0.1:1/none', { max: 1 });
    const app = createApp({ env, logger: createLogger(env), db: broken.db });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe(false);
    await broken.close();
  });
});
