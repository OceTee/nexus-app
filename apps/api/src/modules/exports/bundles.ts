// Export formats (TDD Section H, Data export). The same formats the app
// produces on the device: a Markdown bundle (one .md per note with YAML
// front-matter, attachments under attachments/, index.json) and JSON.

import { sanitiseFilename } from '../../integrations/r2';

export interface ExportNote {
  id: string;
  title: string;
  bodyMd: string;
  createdAt: string;
  updatedAt: string;
  collection: string | null;
  tags: string[];
  links: string[];
}

export interface ExportAttachment {
  id: string;
  noteId: string | null;
  filename: string;
  mimeType: string;
  bytes: Uint8Array | null;
}

/** YAML scalar: quoted unless it is a plain safe word. */
function yaml(value: string): string {
  return /^[A-Za-z0-9 ._/-]+$/.test(value) && !/^\s|\s$/.test(value)
    ? value
    : JSON.stringify(value);
}

function frontMatter(n: ExportNote): string {
  const list = (items: string[]) =>
    items.length ? `\n${items.map((i) => `  - ${yaml(i)}`).join('\n')}` : ' []';
  return [
    '---',
    `id: ${n.id}`,
    `title: ${yaml(n.title)}`,
    `created: ${n.createdAt}`,
    `updated: ${n.updatedAt}`,
    `collection: ${n.collection === null ? 'null' : yaml(n.collection)}`,
    `tags:${list(n.tags)}`,
    `links:${list(n.links)}`,
    '---',
    '',
  ].join('\n');
}

/** Files for the Markdown bundle, keyed by path inside the zip. */
export function markdownBundleFiles(
  notes: ExportNote[],
  attachments: ExportAttachment[],
): Record<string, Uint8Array> {
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const index: {
    notes: Record<string, string>;
    attachments: Record<string, string>;
    omitted: string[];
  } = {
    notes: {},
    attachments: {},
    omitted: [],
  };

  for (const n of notes) {
    const base = sanitiseFilename(n.title || 'Untitled').replace(/\.md$/i, '') || 'Untitled';
    let path = `notes/${base}.md`;
    for (let i = 2; used.has(path.toLowerCase()); i++) path = `notes/${base} (${i}).md`;
    used.add(path.toLowerCase());
    files[path] = enc.encode(frontMatter(n) + n.bodyMd + (n.bodyMd.endsWith('\n') ? '' : '\n'));
    index.notes[n.id] = path;
  }
  for (const a of attachments) {
    if (!a.bytes) {
      index.omitted.push(a.id);
      continue;
    }
    const path = `attachments/${a.id}/${sanitiseFilename(a.filename)}`;
    files[path] = a.bytes;
    index.attachments[a.id] = path;
  }
  files['index.json'] = enc.encode(JSON.stringify(index, null, 2));
  return files;
}
