// The database handle (src/infra/db.ts): opened once, transactions queued one
// at a time and retried while SQLite reports the database as locked. These
// guard the fix for the "database is locked" crashes seen on a real phone.

import type { SqlDb } from '../../src/infra/sql';

const mockOpen = jest.fn();
const mockMigrate = jest.fn();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: (...a: unknown[]) => mockOpen(...a) }));
jest.mock('../../src/infra/migrations', () => ({ migrate: (db: unknown) => mockMigrate(db) }));

type Db = typeof import('../../src/infra/db');

/** A raw expo-sqlite stand-in whose transactions run the task with itself. */
function fakeRaw(tx?: (task: (t: SqlDb) => Promise<void>) => Promise<void>) {
  const run = tx ?? ((task: (t: SqlDb) => Promise<void>) => task(raw));
  const raw = {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
    getFirstAsync: jest.fn().mockResolvedValue({ n: 1 }),
    getAllAsync: jest.fn().mockResolvedValue([{ n: 1 }]),
    withExclusiveTransactionAsync: jest.fn(run),
  } as unknown as SqlDb & { withExclusiveTransactionAsync: jest.Mock; execAsync: jest.Mock };
  return raw;
}

/** A fresh copy of the module, since it keeps the handle in module state. */
function load(): Db {
  let mod!: Db;
  jest.isolateModules(() => {
    mod = jest.requireActual('../../src/infra/db') as Db;
  });
  return mod;
}

beforeEach(() => {
  mockOpen.mockReset();
  mockMigrate.mockReset().mockResolvedValue(undefined);
  jest.useRealTimers();
});

describe('openDatabase', () => {
  it('opens once with WAL, foreign keys and a busy timeout, then migrates', async () => {
    const raw = fakeRaw();
    mockOpen.mockResolvedValue(raw);
    const { openDatabase, getDb } = load();
    expect(() => getDb()).toThrow('Database not open yet');

    const [a, b] = await Promise.all([openDatabase(), openDatabase()]);
    expect(a).toBe(b);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(raw.execAsync).toHaveBeenCalledWith(expect.stringContaining('busy_timeout = 5000'));
    expect(mockMigrate).toHaveBeenCalledWith(a);
    expect(getDb()).toBe(a);
  });

  it('tries again after a failed open', async () => {
    mockOpen.mockRejectedValueOnce(new Error('disk I/O error')).mockResolvedValue(fakeRaw());
    const { openDatabase } = load();
    await expect(openDatabase()).rejects.toThrow('disk I/O error');
    await expect(openDatabase()).resolves.toBeDefined();
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it('passes plain statements straight through', async () => {
    const raw = fakeRaw();
    mockOpen.mockResolvedValue(raw);
    const db = await load().openDatabase();
    await db.execAsync('SELECT 1');
    await db.runAsync('UPDATE x SET y = ?', [1]);
    expect(await db.getFirstAsync('SELECT 1')).toEqual({ n: 1 });
    expect(await db.getAllAsync('SELECT 1')).toEqual([{ n: 1 }]);
    expect(raw.runAsync).toHaveBeenCalledWith('UPDATE x SET y = ?', [1]);
  });
});

describe('exclusive transactions', () => {
  async function open(raw: SqlDb) {
    mockOpen.mockResolvedValue(raw);
    return load().openDatabase();
  }

  it('run one at a time, in order', async () => {
    const db = await open(fakeRaw());
    const log: string[] = [];
    const slow = (name: string, ms: number) => async () => {
      log.push(`${name} start`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${name} end`);
    };
    await Promise.all([
      db.withExclusiveTransactionAsync(slow('a', 20)),
      db.withExclusiveTransactionAsync(slow('b', 1)),
    ]);
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end']);
  });

  it('retry while the database is locked, with backoff', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const raw = fakeRaw(async (task) => {
      calls += 1;
      if (calls < 3) throw new Error('Error code 5: database is locked');
      await task(raw);
    });
    const db = await open(raw);
    const task = jest.fn().mockResolvedValue(undefined);
    const done = db.withExclusiveTransactionAsync(task);
    await jest.advanceTimersByTimeAsync(50 + 100);
    await done;
    expect(calls).toBe(3);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('give up after six retries', async () => {
    jest.useFakeTimers();
    const raw = fakeRaw(async () => {
      throw new Error('SQLITE_BUSY');
    });
    const db = await open(raw);
    const done = db.withExclusiveTransactionAsync(async () => undefined);
    const caught = done.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(50 * (2 ** 7 - 1));
    expect(String(await caught)).toContain('SQLITE_BUSY');
    expect(raw.withExclusiveTransactionAsync).toHaveBeenCalledTimes(7);
  });

  it('fail at once on other errors, and the queue keeps going', async () => {
    const db = await open(fakeRaw());
    await expect(
      db.withExclusiveTransactionAsync(async () => {
        throw new Error('constraint failed');
      }),
    ).rejects.toThrow('constraint failed');
    const after = jest.fn().mockResolvedValue(undefined);
    await db.withExclusiveTransactionAsync(after);
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('setDbForTests', () => {
  it('makes the injected database the open one', async () => {
    const { setDbForTests, getDb, openDatabase } = load();
    const injected = fakeRaw();
    setDbForTests(injected);
    expect(getDb()).toBe(injected);
    expect(await openDatabase()).toBe(injected);
  });
});
