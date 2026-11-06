import { parseWikiLinks } from '@nexus/shared';
import { strToU8, zip, type Zippable } from 'fflate';
import { Directory, File, Paths } from 'expo-file-system';
import { repos } from '@/data/repos';
import type { AttachmentRow } from '@/data/rows';
import { getDb } from '@/infra/db';
import { cachedFile, ensureCached } from '../attachments/cache';
import { collectionPath } from '../notes/useNoteDecor';
import {
  assignPaths,
  EXPORT_FORMAT_VERSION,
  noteToMarkdown,
  slug,
  type BundleIndex,
  type ExportNote,
  type JsonExport,
} from './serialise';

export type ExportFormat = 'markdown' | 'json';

export interface ExportOptions {
  format: ExportFormat;
  /** Limit to one collection (and its sub-collections). */
  collectionId: string | null;
  includeAttachments: boolean;
  /** JSON only: include the local version history. */
  includeVersions: boolean;
}

export interface ExportProgress {
  phase: 'notes' | 'attachments' | 'zip' | 'done';
  done: number;
  total: number;
}

export interface ExportResult {
  file: File;
  notes: number;
  attachments: number;
  /** Attachments left out (not cached and could not be downloaded). */
  omitted: string[];
}

/** Notes (and attachments) in scope, for the estimate on S-33. */
export async function exportScope(collectionId: string | null) {
  const db = getDb();
  const collections = await repos.collections.list();
  const ids = new Set<string>();
  if (collectionId) {
    const stack = [collectionId];
    while (stack.length) {
      const id = stack.pop()!;
      ids.add(id);
      for (const c of collections) if (c.parentId === id) stack.push(c.id);
    }
  }
  const all = await repos.notes.list({ limit: 1_000_000 });
  const notes = collectionId ? all.filter((n) => n.collectionId && ids.has(n.collectionId)) : all;
  const noteIds = new Set(notes.map((n) => n.id));
  const attachments = (
    await db.getAllAsync<AttachmentRow>(`SELECT * FROM attachments WHERE deleted_at IS NULL`)
  ).filter((a) => a.note_id && noteIds.has(a.note_id));
  const cached = await db.getAllAsync<{ attachment_id: string }>(
    `SELECT attachment_id FROM attachment_cache`,
  );
  const cachedIds = new Set(cached.map((c) => c.attachment_id));
  return {
    notes,
    attachments,
    collections,
    needDownload: attachments.filter((a) => !cachedIds.has(a.id)).length,
  };
}

const zipAsync = (files: Zippable) =>
  new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data))),
  );

/** Builds the export on the device and returns the zip file (S-33). */
export async function runExport(
  opts: ExportOptions,
  onProgress: (p: ExportProgress) => void,
): Promise<ExportResult> {
  const db = getDb();
  const scope = await exportScope(opts.collectionId);
  const tags = await repos.tags.list();
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const collectionMap = new Map(scope.collections.map((c) => [c.id, c]));
  const pathNames = (id: string | null) => collectionPath(collectionMap, id).map((c) => c.name);

  const memberships = await db.getAllAsync<{ note_id: string; tag_id: string }>(
    `SELECT note_id, tag_id FROM note_tags WHERE deleted_at IS NULL`,
  );
  const linkTitles = (body: string) => {
    const seen = new Set<string>();
    return parseWikiLinks(body).flatMap((l) =>
      seen.has(l.targetNorm) ? [] : (seen.add(l.targetNorm), [l.target]),
    );
  };
  const notes: ExportNote[] = scope.notes.map((n) => ({
    id: n.id,
    title: n.title,
    bodyMd: n.bodyMd,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    isPinned: n.isPinned,
    collectionId: n.collectionId,
    tagIds: memberships.filter((m) => m.note_id === n.id).map((m) => m.tag_id),
    links: linkTitles(n.bodyMd),
  }));

  const files: Zippable = {};
  const omitted: string[] = [];
  const attachmentPaths = new Map<string, string>();
  const stamp = new Date().toISOString();

  if (opts.includeAttachments) {
    let done = 0;
    for (const a of scope.attachments) {
      onProgress({ phase: 'attachments', done, total: scope.attachments.length });
      try {
        const file = (await cachedFile(a.id)) ?? (await ensureCached(a));
        const path = `attachments/${a.id}-${slug(a.filename, 'file')}`;
        files[path] = [await file.bytes(), { level: 0 }];
        attachmentPaths.set(a.id, path);
      } catch {
        omitted.push(a.filename);
      }
      done += 1;
    }
  }

  const collectionsOut = scope.collections.map((c) => ({
    id: c.id,
    parentId: c.parentId,
    name: c.name,
  }));
  const tagsOut = tags.map((t) => ({ id: t.id, name: t.name, colour: t.colour }));

  if (opts.format === 'markdown') {
    const paths = assignPaths(notes, pathNames);
    notes.forEach((n, i) => {
      onProgress({ phase: 'notes', done: i, total: notes.length });
      let body = n.bodyMd;
      // Point attachment references at the bundled files.
      for (const [id, path] of attachmentPaths) {
        const depth = (paths.get(n.id) ?? '').split('/').length - 1;
        body = body.split(`nexus://attachment/${id}`).join(`${'../'.repeat(depth)}${path}`);
      }
      const md = noteToMarkdown(
        { ...n, bodyMd: body },
        pathNames(n.collectionId).join('/'),
        n.tagIds.map((id) => tagById.get(id)?.name).filter((x): x is string => Boolean(x)),
      );
      files[paths.get(n.id)!] = strToU8(md);
    });
    const index: BundleIndex = {
      format: 'nexus-markdown-bundle',
      version: EXPORT_FORMAT_VERSION,
      exportedAt: stamp,
      notes: notes.map((n) => ({ id: n.id, title: n.title, path: paths.get(n.id)! })),
      attachments: scope.attachments.map((a) => ({
        id: a.id,
        noteId: a.note_id,
        filename: a.filename,
        path: attachmentPaths.get(a.id) ?? null,
      })),
      collections: collectionsOut,
      tags: tagsOut,
    };
    files['index.json'] = strToU8(JSON.stringify(index, null, 2));
  } else {
    const out: JsonExport = {
      format: 'nexus-json',
      version: EXPORT_FORMAT_VERSION,
      exportedAt: stamp,
      notes: [],
      collections: collectionsOut,
      tags: tagsOut,
      attachments: scope.attachments.map((a) => ({
        id: a.id,
        noteId: a.note_id,
        filename: a.filename,
        mimeType: a.mime_type,
        sizeBytes: a.size_bytes,
        sha256: a.sha256,
      })),
    };
    for (let i = 0; i < notes.length; i += 1) {
      onProgress({ phase: 'notes', done: i, total: notes.length });
      const n = notes[i]!;
      const versions = opts.includeVersions
        ? (await repos.versions.local(n.id)).map((v) => ({
            rev: v.rev,
            title: v.title,
            bodyMd: v.body_md,
            createdAt: v.created_at,
          }))
        : undefined;
      out.notes.push(versions ? { ...n, versions } : n);
    }
    files['nexus.json'] = strToU8(JSON.stringify(out, null, 2));
  }

  onProgress({ phase: 'zip', done: 0, total: 1 });
  const data = await zipAsync(files);
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const name = `nexus-${opts.format === 'markdown' ? 'markdown' : 'json'}-${stamp.slice(0, 10)}.zip`;
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(data);
  onProgress({ phase: 'done', done: 1, total: 1 });
  return {
    file,
    notes: notes.length,
    attachments: attachmentPaths.size,
    omitted,
  };
}
