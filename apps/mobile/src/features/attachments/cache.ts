// Local copies of attachments (TDD Section D, File storage): files live in
// Paths.cache/attachments and are evicted least-recently-used above 500 MB;
// pinned files ("keep offline") move to Paths.document and are never evicted.

import { Directory, File, Paths } from 'expo-file-system';
import { events } from '@/data/events';
import type { AttachmentRow } from '@/data/rows';
import { api } from '@/infra/apiClient';
import { getDb } from '@/infra/db';

export const CACHE_LIMIT_BYTES = 500 * 1024 * 1024;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function dir(pinned: boolean): Directory {
  const d = new Directory(pinned ? Paths.document : Paths.cache, 'attachments');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

/** Where an attachment's bytes live on this device (it may not exist yet). */
export function fileFor(a: Pick<AttachmentRow, 'id' | 'mime_type'>, pinned = false): File {
  return new File(dir(pinned), `${a.id}.${EXT[a.mime_type] ?? 'bin'}`);
}

interface CacheRow {
  attachment_id: string;
  local_path: string;
  size_bytes: number;
  pinned: number;
}

const now = () => new Date().toISOString();

/** Records a file that is now on disk (after picking or downloading). */
export async function recordCached(
  id: string,
  file: File,
  sizeBytes: number,
  pinned = false,
): Promise<void> {
  const ts = now();
  await getDb().runAsync(
    `INSERT INTO attachment_cache (attachment_id, local_path, size_bytes, pinned, cached_at, last_access_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(attachment_id) DO UPDATE SET local_path = excluded.local_path,
       size_bytes = excluded.size_bytes, last_access_at = excluded.last_access_at`,
    [id, file.uri, sizeBytes, pinned ? 1 : 0, ts, ts],
  );
  await evict();
}

/** The local file if it is cached, touching its LRU timestamp. */
export async function cachedFile(id: string): Promise<File | null> {
  const db = getDb();
  const row = await db.getFirstAsync<CacheRow>(
    `SELECT * FROM attachment_cache WHERE attachment_id = ?`,
    [id],
  );
  if (!row) return null;
  const file = new File(row.local_path);
  if (!file.exists) {
    await db.runAsync(`DELETE FROM attachment_cache WHERE attachment_id = ?`, [id]);
    return null;
  }
  await db.runAsync(`UPDATE attachment_cache SET last_access_at = ? WHERE attachment_id = ?`, [
    now(),
    id,
  ]);
  return file;
}

/**
 * Returns a local copy, downloading it through a presigned GET when needed.
 * Throws when offline and not cached.
 */
export async function ensureCached(a: AttachmentRow): Promise<File> {
  const hit = await cachedFile(a.id);
  if (hit) return hit;
  const { url } = await api<{ url: string; expiresAt: string }>(`/v1/attachments/${a.id}/url`);
  const target = fileFor(a);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(url, target);
  await recordCached(a.id, file, file.size ?? a.size_bytes);
  return file;
}

/** Keeps a file for offline use (moves it out of the evictable cache), or releases it. */
export async function setPinned(a: AttachmentRow, pinned: boolean): Promise<void> {
  const current = await ensureCached(a);
  const target = fileFor(a, pinned);
  if (current.uri !== target.uri) {
    if (target.exists) target.delete();
    current.move(target);
  }
  await getDb().runAsync(
    `UPDATE attachment_cache SET pinned = ?, local_path = ? WHERE attachment_id = ?`,
    [pinned ? 1 : 0, target.uri, a.id],
  );
  events.emit('attachments');
}

export async function isPinned(id: string): Promise<boolean> {
  const r = await getDb().getFirstAsync<{ pinned: number }>(
    `SELECT pinned FROM attachment_cache WHERE attachment_id = ?`,
    [id],
  );
  return r?.pinned === 1;
}

/** Deletes least-recently-used unpinned files until the cache fits the limit. */
export async function evict(limit = CACHE_LIMIT_BYTES): Promise<number> {
  const db = getDb();
  const rows = await db.getAllAsync<CacheRow & { last_access_at: string }>(
    `SELECT c.* FROM attachment_cache c
     LEFT JOIN attachments a ON a.id = c.attachment_id
     WHERE c.pinned = 0 AND coalesce(a.status, 'uploaded') != 'pending'
     ORDER BY c.last_access_at ASC`,
  );
  let total = rows.reduce((n, r) => n + Number(r.size_bytes), 0);
  let freed = 0;
  for (const r of rows) {
    if (total <= limit) break;
    try {
      const f = new File(r.local_path);
      if (f.exists) f.delete();
    } catch {
      // already gone
    }
    await db.runAsync(`DELETE FROM attachment_cache WHERE attachment_id = ?`, [r.attachment_id]);
    total -= Number(r.size_bytes);
    freed += Number(r.size_bytes);
  }
  return freed;
}

/** Bytes used by cached and pinned attachments (Settings, Privacy). */
export async function cacheUsage(): Promise<{ cached: number; pinned: number }> {
  const r = await getDb().getFirstAsync<{ cached: number; pinned: number }>(
    `SELECT coalesce(sum(CASE WHEN pinned = 0 THEN size_bytes END), 0) AS cached,
            coalesce(sum(CASE WHEN pinned = 1 THEN size_bytes END), 0) AS pinned
     FROM attachment_cache`,
  );
  return { cached: Number(r?.cached ?? 0), pinned: Number(r?.pinned ?? 0) };
}
