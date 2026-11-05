import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, type DbHandle } from '../../src/db/client';
import { DEMO_EMAIL } from '../../src/db/seed/demoCorpus';
import { seedDemo, type SeedSummary } from '../../src/db/seed/seedDemo';
import { withUser } from '../../src/db/withUser';
import * as s from '../../src/db/schema';

let owner: DbHandle;
let api: DbHandle;
let summary: SeedSummary;

const HASH = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';

beforeAll(async () => {
  owner = createDb(inject('ownerUrl'), { max: 2 });
  api = createDb(inject('apiUrl'), { max: 2 });
  summary = await seedDemo(owner.db, HASH);
});

afterAll(async () => {
  await owner.close();
  await api.close();
});

describe('demo seed', () => {
  it('produces the corpus described in the TDD', () => {
    expect(summary).toMatchObject({
      collections: 3,
      tags: 12,
      notes: 60,
      versions: 200,
      attachments: 8,
      ghostLinks: 1,
    });
  });

  it('nests the three collections', async () => {
    const rows = await withUser(api.db, summary.userId, (tx) => tx.select().from(s.collections));
    const depth = (id: string | null): number =>
      id === null ? 0 : 1 + depth(rows.find((r) => r.id === id)!.parentId);
    expect(Math.max(...rows.map((r) => depth(r.id)))).toBe(3);
  });

  it('forms three link clusters plus two orphans', async () => {
    const notes = await withUser(api.db, summary.userId, (tx) =>
      tx.select({ id: s.notes.id }).from(s.notes),
    );
    const edges = await withUser(api.db, summary.userId, (tx) =>
      tx
        .select()
        .from(s.noteLinks)
        .where(sql`target_note_id IS NOT NULL`),
    );
    // Union-find over the link graph.
    const parent = new Map(notes.map((n) => [n.id, n.id]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    for (const e of edges) parent.set(find(e.sourceNoteId), find(e.targetNoteId!));
    const sizes = new Map<string, number>();
    for (const n of notes) sizes.set(find(n.id), (sizes.get(find(n.id)) ?? 0) + 1);
    const components = [...sizes.values()].sort((a, b) => b - a);
    expect(components).toEqual([20, 19, 19, 1, 1]);
  });

  it('is idempotent: re-running replaces the demo user', async () => {
    const again = await seedDemo(owner.db, HASH);
    const users = await owner.db.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE email = ${DEMO_EMAIL}`,
    );
    expect((users.rows[0] as { n: number }).n).toBe(1);
    expect(again.userId).not.toBe(summary.userId);
    const notes = await owner.db.execute(
      sql`SELECT count(*)::int AS n FROM notes WHERE user_id = ${again.userId}`,
    );
    expect((notes.rows[0] as { n: number }).n).toBe(60);
    summary = again;
  });

  it('stores searchable plain text and excerpts', async () => {
    const hits = await withUser(api.db, summary.userId, (tx) =>
      tx.execute(
        sql`SELECT title FROM notes WHERE search_tsv @@ plainto_tsquery('english', 'noisy measurements')`,
      ),
    );
    expect(hits.rows.length).toBeGreaterThan(0);
  });
});
