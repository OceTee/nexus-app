// Adding and uploading attachments (TDD Section D, File storage; S-27). The
// file is copied into the cache and recorded as `pending` at once, so it works
// offline; the upload (create → PUT → complete) runs when online and resumes
// after reconnecting.

import {
  ATTACHMENT_MIME_TYPES,
  LIMITS,
  type AttachmentCreatedDto,
  type AttachmentDto,
} from '@nexus/shared';
import * as DocumentPicker from 'expo-document-picker';
import { File, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { events } from '@/data/events';
import { repos } from '@/data/repos';
import type { AttachmentRow } from '@/data/rows';
import { ApiError, api } from '@/infra/apiClient';
import { getDb } from '@/infra/db';
import { uuidv7 } from '@/infra/ids';
import { useSessionStore } from '@/stores/session';
import { fileFor, recordCached } from './cache';

export type PickSource = 'camera' | 'library' | 'files';

export class AttachmentError extends Error {}

interface Picked {
  uri: string;
  name: string;
  mimeType: string;
  width?: number | undefined;
  height?: number | undefined;
}

async function pick(source: PickSource): Promise<Picked | null> {
  if (source === 'files') {
    const r = await DocumentPicker.getDocumentAsync({
      type: [...ATTACHMENT_MIME_TYPES, 'image/heic'],
      copyToCacheDirectory: true,
    });
    const a = r.canceled ? null : r.assets[0];
    return a
      ? { uri: a.uri, name: a.name, mimeType: a.mimeType ?? 'application/octet-stream' }
      : null;
  }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new AttachmentError('Allow camera access in Settings to take photos.');
  }
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.85,
    exif: false,
  };
  const r =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return {
    uri: a.uri,
    name: a.fileName ?? `photo-${Date.now()}.jpg`,
    mimeType: a.mimeType ?? 'image/jpeg',
    width: a.width,
    height: a.height,
  };
}

/** HEIC/HEIF and other image types the API does not accept become JPEG on the device. */
async function normalise(p: Picked): Promise<Picked> {
  if ((ATTACHMENT_MIME_TYPES as readonly string[]).includes(p.mimeType)) return p;
  if (!p.mimeType.startsWith('image/')) {
    throw new AttachmentError('NEXUS can attach JPEG, PNG, WebP images and PDFs.');
  }
  const ctx = ImageManipulator.manipulate(p.uri);
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return {
    uri: out.uri,
    name: p.name.replace(/\.[^.]+$/, '') + '.jpg',
    mimeType: 'image/jpeg',
    width: out.width,
    height: out.height,
  };
}

const safeName = (name: string) =>
  name
    .replace(/[/\\]/g, '-')
    .replace(/[\x00-\x1f]/g, '')
    .trim()
    .slice(0, LIMITS.filenameMax) || 'file';

/**
 * Picks a file, stores it locally as a pending attachment of the note and
 * appends a Markdown reference to the note body. Returns null if cancelled.
 */
export async function addAttachment(
  noteId: string,
  source: PickSource,
): Promise<AttachmentRow | null> {
  const picked = await pick(source);
  if (!picked) return null;
  const p = await normalise(picked);

  const id = uuidv7();
  const row: AttachmentRow = {
    id,
    note_id: noteId,
    filename: safeName(p.name),
    mime_type: p.mimeType,
    size_bytes: 0,
    sha256: '',
    status: 'pending',
    width: p.width ?? null,
    height: p.height ?? null,
    server_rev: 0,
    local_rev: 1,
    dirty: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };
  const target = fileFor(row);
  const source_ = new File(p.uri);
  await source_.copy(target);
  const size = target.size ?? 0;
  if (size > LIMITS.attachmentBytesMax) {
    target.delete();
    throw new AttachmentError('Attachments can be up to 25 MB.');
  }
  row.size_bytes = size;
  row.sha256 = (await target.digest('SHA-256')).toLowerCase();

  const db = getDb();
  await db.runAsync(
    `INSERT INTO attachments (id, note_id, filename, mime_type, size_bytes, sha256, status, width, height,
       server_rev, local_rev, dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, 1, 1, ?, ?)`,
    [
      id,
      noteId,
      row.filename,
      row.mime_type,
      size,
      row.sha256,
      row.width,
      row.height,
      row.created_at,
      row.updated_at,
    ],
  );
  await recordCached(id, target, size);

  const note = await repos.notes.get(noteId);
  if (note) {
    const link = row.mime_type.startsWith('image/')
      ? `![${row.filename}](nexus://attachment/${id})`
      : `[${row.filename}](nexus://attachment/${id})`;
    const sep = note.bodyMd && !note.bodyMd.endsWith('\n') ? '\n\n' : note.bodyMd ? '\n' : '';
    await repos.notes.save({
      id: noteId,
      title: note.title,
      bodyMd: `${note.bodyMd}${sep}${link}\n`,
    });
  }
  events.emit('attachments');
  void uploadPending();
  return row;
}

/** Removes an attachment from its note and the device; the server copy is deleted when online. */
export async function deleteAttachment(a: AttachmentRow): Promise<void> {
  const db = getDb();
  await db.runAsync(`UPDATE attachments SET deleted_at = ?, dirty = 1 WHERE id = ?`, [
    new Date().toISOString(),
    a.id,
  ]);
  const note = a.note_id ? await repos.notes.get(a.note_id) : null;
  if (note) {
    const re = new RegExp(`!?\\[[^\\]]*\\]\\(nexus://attachment/${a.id}\\)\\n?`, 'g');
    await repos.notes.save({ id: note.id, title: note.title, bodyMd: note.bodyMd.replace(re, '') });
  }
  try {
    const f = fileFor(a);
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
  await db.runAsync(`DELETE FROM attachment_cache WHERE attachment_id = ?`, [a.id]);
  events.emit('attachments');
  void uploadPending();
}

let uploading: Promise<void> | null = null;

/** Uploads pending attachments and sends pending deletes; one pass at a time. */
export function uploadPending(): Promise<void> {
  const s = useSessionStore.getState();
  if (s.status !== 'authed' || !s.user?.emailVerified) return Promise.resolve();
  uploading ??= runUploads().finally(() => {
    uploading = null;
  });
  return uploading;
}

async function runUploads(): Promise<void> {
  const db = getDb();
  const rows = await db.getAllAsync<AttachmentRow>(
    `SELECT * FROM attachments WHERE dirty = 1 ORDER BY created_at`,
  );
  for (const a of rows) {
    try {
      if (a.deleted_at) {
        if (a.server_rev > 0 || a.status === 'uploaded') {
          await api(`/v1/attachments/${a.id}`, { method: 'DELETE' }).catch((e: unknown) => {
            if (!(e instanceof ApiError) || e.status !== 404) throw e;
          });
        }
        await db.runAsync(`DELETE FROM attachments WHERE id = ?`, [a.id]);
        continue;
      }
      if (a.status !== 'pending' || !a.note_id) continue;
      const file = fileFor(a);
      if (!file.exists) continue;

      let created: AttachmentCreatedDto | null = null;
      try {
        created = await api<AttachmentCreatedDto>('/v1/attachments', {
          method: 'POST',
          body: {
            id: a.id,
            noteId: a.note_id,
            filename: a.filename,
            mimeType: a.mime_type,
            sizeBytes: a.size_bytes,
            sha256: a.sha256,
            ...(a.width ? { width: a.width } : {}),
            ...(a.height ? { height: a.height } : {}),
          },
        });
      } catch (e) {
        // Created on an earlier attempt: go straight to completing it.
        if (!(e instanceof ApiError) || e.status !== 409) throw e;
      }
      if (created) {
        const res = await file.upload(created.upload.url, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: created.upload.headers,
        });
        if (res.status < 200 || res.status >= 300) throw new Error(`Upload failed (${res.status})`);
      }
      const done = await api<AttachmentDto>(`/v1/attachments/${a.id}/complete`, { method: 'POST' });
      await db.runAsync(
        `UPDATE attachments SET status = ?, server_rev = ?, dirty = 0, updated_at = ? WHERE id = ?`,
        [done.status, done.serverRev, done.updatedAt, a.id],
      );
      events.emit('attachments');
    } catch (e) {
      // Network or server trouble: leave it pending; the next sync retries.
      if (e instanceof ApiError && e.isNetwork) return;
    }
  }
}
