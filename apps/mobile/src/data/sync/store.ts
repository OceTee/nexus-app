import { create } from 'zustand';
import { kv } from '@/infra/kv';

export type SyncReason =
  'foreground' | 'network' | 'write' | 'push' | 'manual' | 'periodic' | 'retry' | 'start';

export type SyncRunState =
  | { kind: 'idle' }
  | { kind: 'running'; batch: number }
  | { kind: 'offline' }
  | { kind: 'paused'; why: 'unverified' | 'signed-out' }
  | { kind: 'error'; code: string; message: string; retryAt: number | null };

export interface SyncError {
  at: string;
  code: string;
  message: string;
}

interface SyncStore {
  state: SyncRunState;
  online: boolean | null;
  lastSyncAt: number | null;
  errors: SyncError[];
  set(patch: Partial<Omit<SyncStore, 'set' | 'addError'>>): void;
  addError(e: Omit<SyncError, 'at'>): void;
}

const ERRORS_KEY = 'nexus.sync.errors';
const LAST_KEY = 'nexus.sync.lastSyncAt';
/** S-32 shows the last 10 sync errors. */
const MAX_ERRORS = 10;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = kv.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Live sync status for the pill, banners and S-32. */
export const useSyncStore = create<SyncStore>()((set, get) => ({
  state: { kind: 'idle' },
  online: null,
  lastSyncAt: load<number | null>(LAST_KEY, null),
  errors: load<SyncError[]>(ERRORS_KEY, []),
  set(patch) {
    set(patch);
    if (patch.lastSyncAt !== undefined) kv.setJson(LAST_KEY, patch.lastSyncAt);
  },
  addError(e) {
    const errors = [{ ...e, at: new Date().toISOString() }, ...get().errors].slice(0, MAX_ERRORS);
    set({ errors });
    kv.setJson(ERRORS_KEY, errors);
  },
}));

/** Exponential backoff with jitter: 2, 4, 8 … 300 seconds (TDD Section D). */
export class Backoff {
  private attempt = 0;
  next(): number {
    const base = Math.min(300, 2 ** (this.attempt + 1));
    this.attempt += 1;
    const jitter = base * 0.2 * Math.random();
    return Date.now() + Math.round((base + jitter) * 1000);
  }
  reset(): void {
    this.attempt = 0;
  }
}
