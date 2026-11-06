import { uuidv7 } from '../../src/infra/ids';
import { migrate, SCHEMA_VERSION } from '../../src/infra/migrations';
import { createTestDb } from '../../src/test/nodeSqlite';

describe('migrations', () => {
  it('creates the schema with FTS5 and records the schema version', async () => {
    const db = await createTestDb();
    const v = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = 'schema_version'`,
    );
    expect(Number(v!.value)).toBe(SCHEMA_VERSION);
    const tables = (
      await db.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    ).map((x) => x.name);
    for (const t of [
      'notes',
      'notes_fts',
      'collections',
      'tags',
      'note_tags',
      'note_links',
      'attachments',
      'note_versions_local',
      'outbox',
      'conflicts',
      'attachment_cache',
      'sync_state',
    ]) {
      expect(tables).toContain(t);
    }
    expect(await db.getFirstAsync(`SELECT value FROM sync_state WHERE key = 'cursor'`)).toEqual({
      value: '0',
    });
  });

  it('is a no-op when up to date and applies only newer steps', async () => {
    const db = await createTestDb();
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    const next = await migrate(db, [
      { version: 1, up: ['SELECT broken syntax here'] },
      { version: 2, up: ['CREATE TABLE extra (id TEXT)'] },
    ]);
    expect(next).toBe(2);
  });

  it('rolls back every step of a failed migration', async () => {
    const db = await createTestDb();
    await expect(
      migrate(db, [{ version: 9, up: ['CREATE TABLE partial (id TEXT)', 'NOT SQL'] }]),
    ).rejects.toThrow();
    expect(
      await db.getFirstAsync(`SELECT name FROM sqlite_master WHERE name = 'partial'`),
    ).toBeNull();
  });
});

describe('uuidv7', () => {
  it('produces time-ordered version-7 ids', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(a.slice(0, 13)).toBe('018bcfe5-6800');
  });
});
