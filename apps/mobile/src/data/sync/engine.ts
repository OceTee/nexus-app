// The sync engine (TDD Section G, Sync engine algorithm): one run at a time,
// push a batch of outbox ops, apply results + changes + conflicts + cursor in
// one exclusive transaction, loop while the server has more or ops remain.

import {
  CLIENT_SCHEMA_VERSION,
  type SnapshotPageDto,
  type SyncPushRequest,
  type SyncResponse,
  type SyncStatusDto,
} from '@nexus/shared';
import { ApiError, api } from '@/infra/apiClient';
import { getDb } from '@/infra/db';
import { useSessionStore } from '@/stores/session';
import { events, type Table } from '../events';
import { repos } from '../repos';
import { applyChanges, applyResults, mergeReports, storeConflicts } from './applyChanges';
import { Backoff, useSyncStore, type SyncReason } from './store';

/** 4xx responses that are not about the request's content. */
const TRANSIENT_4XX = new Set([401, 408, 409, 429]);
/** Ops failing with other 4xx are parked as `failed` after this many attempts (S-32). */
const MAX_ATTEMPTS = 3;
/** Guard against a server that keeps saying hasMore. */
const MAX_BATCHES = 200;

export type SyncOutcome =
  | { kind: 'ok'; batches: number }
  | { kind: 'skipped'; reason: 'busy' | 'offline' | 'paused' }
  | { kind: 'error'; error: unknown };

let running: Promise<SyncOutcome> | null = null;
const backoff = new Backoff();

/** Runs a sync unless one is already running (the mutex), and returns its outcome. */
export function runSync(reason: SyncReason): Promise<SyncOutcome> {
  if (running) return Promise.resolve({ kind: 'skipped', reason: 'busy' });
  running = run(reason).finally(() => {
    running = null;
  });
  return running;
}

export function isSyncRunning(): boolean {
  return running !== null;
}

function emit(tables: Iterable<Table>) {
  const list = [...tables];
  if (list.length > 0) events.emit(...list);
}

async function run(reason: SyncReason): Promise<SyncOutcome> {
  const store = useSyncStore.getState();
  const session = useSessionStore.getState();
  if (session.status !== 'authed' || !session.deviceId) {
    store.set({ state: { kind: 'paused', why: 'signed-out' } });
    return { kind: 'skipped', reason: 'paused' };
  }
  if (session.user && !session.user.emailVerified) {
    store.set({ state: { kind: 'paused', why: 'unverified' } });
    return { kind: 'skipped', reason: 'paused' };
  }
  if (store.online === false && reason !== 'manual') {
    store.set({ state: { kind: 'offline' } });
    return { kind: 'skipped', reason: 'offline' };
  }

  const db = getDb();
  let batch = 0;
  try {
    store.set({ state: { kind: 'running', batch } });
    let more = true;
    while (more && batch < MAX_BATCHES) {
      const ops = await repos.outbox.takeBatch(db);
      const cursor = await repos.syncState.cursor();
      const body: SyncPushRequest = {
        deviceId: session.deviceId,
        cursor,
        ops,
        clientSchema: CLIENT_SCHEMA_VERSION,
      };
      const res = await api<SyncResponse>('/v1/sync', { method: 'POST', body });

      const reportBox: { value: ReturnType<typeof mergeReports> | null } = { value: null };
      await db.withExclusiveTransactionAsync(async (tx) => {
        const a = await applyResults(tx, res.results);
        const b = await applyChanges(tx, res.changes);
        const c = await storeConflicts(tx, res.conflicts);
        await repos.syncState.setCursor(res.cursor, tx);
        reportBox.value = mergeReports(a, b, c);
      });
      const report = reportBox.value as ReturnType<typeof mergeReports> | null;
      if (report) {
        emit(report.touched);
        for (const e of report.errors) {
          store.addError({ code: e.code, message: `${e.entity}: ${e.message}` });
        }
      }

      batch += 1;
      useSyncStore.getState().set({ state: { kind: 'running', batch } });
      more = res.hasMore || (await repos.outbox.pendingCount(db)) > 0;
      // Nothing was sent and nothing came back: stop rather than spin on stuck ops.
      if (ops.length === 0 && res.changes.length === 0 && !res.hasMore) more = false;
    }
    backoff.reset();
    useSyncStore.getState().set({ state: { kind: 'idle' }, lastSyncAt: Date.now() });
    return { kind: 'ok', batches: batch };
  } catch (e) {
    return handleFailure(e);
  }
}

async function handleFailure(e: unknown): Promise<SyncOutcome> {
  const db = getDb();
  const store = useSyncStore.getState();
  const err = e instanceof ApiError ? e : null;

  if (
    err &&
    !err.isNetwork &&
    err.status >= 400 &&
    err.status < 500 &&
    !TRANSIENT_4XX.has(err.status)
  ) {
    // The batch itself was refused: park ops that keep failing so the rest can flow.
    await db.runAsync(
      `UPDATE outbox SET status = 'failed', last_error = ? WHERE status = 'inflight' AND attempts >= ?`,
      [`${err.code}: ${err.message}`, MAX_ATTEMPTS],
    );
  }
  await repos.outbox.release(db, err ? `${err.code}: ${err.message}` : String(e));
  events.emit('outbox');

  if (err?.code === 'CURSOR_TOO_OLD') {
    try {
      await bootstrapSnapshot();
      backoff.reset();
      store.set({ state: { kind: 'idle' }, lastSyncAt: Date.now() });
      // Push whatever is still queued on top of the fresh snapshot.
      setTimeout(() => void runSync('retry'), 0);
      return { kind: 'ok', batches: 0 };
    } catch (snapErr) {
      e = snapErr;
    }
  }

  if (err?.isNetwork) {
    store.set({ state: { kind: 'offline' } });
    return { kind: 'error', error: e };
  }
  const code = err?.code ?? 'SYNC_FAILED';
  const message = err?.message ?? (e instanceof Error ? e.message : 'Sync failed');
  const retryAt = err?.retryAfter ? Date.now() + err.retryAfter * 1000 : backoff.next();
  store.addError({ code, message });
  store.set({ state: { kind: 'error', code, message, retryAt } });
  return { kind: 'error', error: e };
}

/**
 * Snapshot bootstrap (TDD Section D, Cursor expiry): pages through the
 * user's current rows and adopts the final change sequence as the cursor.
 * Dirty local rows are kept by the dirty-row rule and pushed afterwards.
 */
export async function bootstrapSnapshot(): Promise<void> {
  const db = getDb();
  let pageCursor: string | null = null;
  for (let page = 0; page < 10_000; page += 1) {
    const qs: string = pageCursor ? `?cursor=${encodeURIComponent(pageCursor)}` : '';
    const res: SnapshotPageDto = await api<SnapshotPageDto>(`/v1/sync/snapshot${qs}`);
    const touched = new Set<Table>();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const r = await applyChanges(tx, res.items);
      r.touched.forEach((t) => touched.add(t));
      if (!res.hasMore) await repos.syncState.setCursor(res.changeSeq, tx);
    });
    emit(touched);
    if (!res.hasMore) return;
    pageCursor = res.nextCursor;
  }
}

/**
 * "Reset and re-download" (S-32): drops every synced (non-dirty) row and
 * re-reads the account from a snapshot. Blocked while ops are pending.
 */
export async function resetAndRedownload(): Promise<void> {
  const db = getDb();
  if ((await repos.outbox.pendingCount(db)) > 0) {
    throw new Error('Sync or discard pending changes first');
  }
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `DELETE FROM note_links WHERE source_note_id IN (SELECT id FROM notes WHERE dirty = 0)`,
    );
    await tx.runAsync(`DELETE FROM note_tags WHERE dirty = 0`);
    await tx.runAsync(`DELETE FROM notes WHERE dirty = 0`);
    await tx.runAsync(`DELETE FROM collections WHERE dirty = 0`);
    await tx.runAsync(`DELETE FROM tags WHERE dirty = 0`);
    await tx.runAsync(`DELETE FROM attachments WHERE dirty = 0`);
    await repos.syncState.setCursor(0, tx);
  });
  events.emit('notes', 'collections', 'tags', 'note_tags', 'note_links', 'attachments');
  await bootstrapSnapshot();
}

/** Puts failed ops back in the queue (S-32 "Retry failed"). */
export async function retryFailed(): Promise<void> {
  await getDb().runAsync(
    `UPDATE outbox SET status = 'pending', attempts = 0 WHERE status = 'failed'`,
  );
  events.emit('outbox');
  await runSync('manual');
}

/** Server-side sync facts for S-32 (online only). */
export function fetchSyncStatus(): Promise<SyncStatusDto> {
  return api<SyncStatusDto>('/v1/sync/status');
}
