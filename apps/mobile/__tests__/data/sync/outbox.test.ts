import { OutboxRepo, type Enqueue } from '../../../src/data/repos/outbox';
import type { SqlDb } from '../../../src/infra/sql';
import { createTestDb } from '../../../src/test/nodeSqlite';

let db: SqlDb;
const outbox = new OutboxRepo();

beforeEach(async () => {
  db = await createTestDb();
});

const ops = async () => (await outbox.all(db)).map((r) => [r.op, r.status]);
const enqueue = (e: Partial<Enqueue>) =>
  outbox.enqueue(db, {
    entityType: 'note',
    entityId: 'n1',
    op: 'upsert',
    baseRev: 2,
    payload: { title: 'T' },
    ...e,
  });

describe('OutboxRepo.enqueue coalescing', () => {
  it('replaces a pending upsert with a delete for an entity the server knows', async () => {
    await enqueue({});
    await enqueue({ op: 'delete', payload: {}, knownToServer: true });
    expect(await ops()).toEqual([['delete', 'pending']]);
  });

  it('drops a pending upsert and the delete for an entity created offline', async () => {
    await enqueue({ baseRev: 0 });
    await enqueue({ op: 'delete', payload: {}, knownToServer: false });
    expect(await ops()).toEqual([]);
  });

  it('queues a delete only once', async () => {
    await enqueue({ op: 'delete', payload: {} });
    await enqueue({ op: 'delete', payload: {} });
    expect(await ops()).toEqual([['delete', 'pending']]);
  });

  it('queues a delete behind an upsert already in flight', async () => {
    await enqueue({});
    await outbox.takeBatch(db);
    await enqueue({ op: 'delete', payload: {}, knownToServer: true });
    expect(await ops()).toEqual([
      ['upsert', 'inflight'],
      ['delete', 'pending'],
    ]);
  });

  it('queues a membership add only once', async () => {
    const add = { entityType: 'note_tag' as const, entityId: 'n1:t1', op: 'add' as const };
    await enqueue({ ...add, payload: { noteId: 'n1', tagId: 't1' } });
    await enqueue({ ...add, payload: { noteId: 'n1', tagId: 't1' } });
    expect(await ops()).toEqual([['add', 'pending']]);
  });

  it('cancels a pending remove with an add', async () => {
    const m = { entityType: 'note_tag' as const, entityId: 'n1:t1', payload: {} };
    await enqueue({ ...m, op: 'remove' });
    await enqueue({ ...m, op: 'add' });
    expect(await ops()).toEqual([]);
  });
});

describe('OutboxRepo sync ops', () => {
  it('maps rows to the wire format', async () => {
    await enqueue({ entityType: 'tag', entityId: 't1', payload: { name: 'x' }, baseRev: null });
    await enqueue({ entityId: 'n2', op: 'delete', payload: {}, baseRev: null });
    await enqueue({
      entityType: 'note_tag',
      entityId: 'n1:t1',
      op: 'remove',
      payload: { noteId: 'n1', tagId: 't1' },
    });
    const batch = await outbox.takeBatch(db);
    expect(batch).toEqual([
      expect.objectContaining({
        type: 'tag.upsert',
        entityId: 't1',
        baseRev: 0,
        payload: { name: 'x' },
      }),
      expect.objectContaining({ type: 'note.delete', entityId: 'n2', baseRev: 0 }),
      expect.objectContaining({ type: 'note_tag.remove', noteId: 'n1', tagId: 't1' }),
    ]);
    expect(batch[1]).not.toHaveProperty('payload');
  });

  it('returns nothing and changes nothing when the outbox is empty', async () => {
    expect(await outbox.takeBatch(db)).toEqual([]);
  });

  it('always sends at least one op, even when it alone exceeds the byte limit', async () => {
    await enqueue({ payload: { body: 'x'.repeat(5_000) } });
    await enqueue({ entityId: 'n2' });
    expect(await outbox.takeBatch(db, 100, 1_000)).toHaveLength(1);
  });

  it('ignores an empty removal', async () => {
    await enqueue({});
    await outbox.remove(db, []);
    expect(await ops()).toHaveLength(1);
  });

  it('does not count failed ops as pending', async () => {
    await enqueue({});
    await enqueue({ entityId: 'n2' });
    await db.runAsync(`UPDATE outbox SET status = 'failed' WHERE entity_id = 'n2'`);
    expect(await outbox.pendingCount(db)).toBe(1);
  });
});
