import { kv } from '../../../src/infra/kv';

// The kv store is backed by expo-sqlite natively; an in-memory map stands in.
jest.mock('../../../src/infra/kv', () => {
  const mem = new Map<string, string>();
  return {
    kv: {
      get: (k: string) => mem.get(k) ?? null,
      set: (k: string, v: string) => void mem.set(k, v),
      remove: (k: string) => void mem.delete(k),
      setJson: (k: string, v: unknown) => void mem.set(k, JSON.stringify(v)),
      clear: () => mem.clear(),
    },
  };
});

type StoreModule = typeof import('../../../src/data/sync/store');
const mem = kv as typeof kv & { clear(): void };

/** Loads a fresh copy of the store so it re-reads persisted values. */
function loadStore(): StoreModule {
  let mod!: StoreModule;
  jest.isolateModules(() => {
    mod = jest.requireActual<StoreModule>('../../../src/data/sync/store');
  });
  return mod;
}

beforeEach(() => mem.clear());
afterEach(() => jest.restoreAllMocks());

describe('useSyncStore', () => {
  it('starts idle with nothing persisted', () => {
    const s = loadStore().useSyncStore.getState();
    expect(s).toMatchObject({
      state: { kind: 'idle' },
      online: null,
      lastSyncAt: null,
      errors: [],
    });
  });

  it('restores the last sync time and errors', () => {
    kv.set('nexus.sync.lastSyncAt', '1234');
    kv.set('nexus.sync.errors', JSON.stringify([{ at: 'x', code: 'A', message: 'a' }]));
    const s = loadStore().useSyncStore.getState();
    expect(s.lastSyncAt).toBe(1234);
    expect(s.errors).toEqual([{ at: 'x', code: 'A', message: 'a' }]);
  });

  it('falls back to defaults when persisted values are corrupt', () => {
    kv.set('nexus.sync.errors', '{not json');
    expect(loadStore().useSyncStore.getState().errors).toEqual([]);
  });

  it('persists lastSyncAt only when it is part of the patch', () => {
    const { useSyncStore } = loadStore();
    useSyncStore.getState().set({ online: true });
    expect(kv.get('nexus.sync.lastSyncAt')).toBeNull();
    useSyncStore.getState().set({ state: { kind: 'idle' }, lastSyncAt: 99 });
    expect(useSyncStore.getState()).toMatchObject({ online: true, lastSyncAt: 99 });
    expect(kv.get('nexus.sync.lastSyncAt')).toBe('99');
  });

  it('keeps the newest 10 errors, newest first, and persists them', () => {
    const { useSyncStore } = loadStore();
    for (let i = 0; i < 12; i += 1)
      useSyncStore.getState().addError({ code: `E${i}`, message: 'm' });
    const errors = useSyncStore.getState().errors;
    expect(errors).toHaveLength(10);
    expect(errors[0]!.code).toBe('E11');
    expect(errors[9]!.code).toBe('E2');
    expect(errors[0]!.at).toEqual(expect.any(String));
    expect(JSON.parse(kv.get('nexus.sync.errors')!)).toEqual(errors);
  });
});

describe('Backoff', () => {
  it('doubles from 2 s up to 300 s, with up to 20 % jitter, and resets', () => {
    const { Backoff } = loadStore();
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const b = new Backoff();
    const delays = Array.from({ length: 10 }, () => b.next() / 1000);
    expect(delays).toEqual([2, 4, 8, 16, 32, 64, 128, 256, 300, 300]);

    random.mockReturnValue(1);
    b.reset();
    expect(b.next()).toBe(2400);
  });
});
