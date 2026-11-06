// Export formats (TDD Section H, Data portability; docs/export-format.md).
// Markdown bundle: one `.md` per note with YAML front-matter (id, title,
// created, updated, collection, tags, links), attachments under
// `attachments/`, and `index.json` mapping ids to paths. JSON: every entity,
// optionally with local versions.

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportNote {
  id: string;
  title: string;
  bodyMd: string;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  collectionId: string | null;
  tagIds: string[];
  /** Titles of notes this one links to. */
  links: string[];
}

export interface ExportCollection {
  id: string;
  parentId: string | null;
  name: string;
}

export interface ExportTag {
  id: string;
  name: string;
  colour: string | null;
}

export interface ExportAttachment {
  id: string;
  noteId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** Characters that force a YAML scalar to be quoted. */
const NEEDS_QUOTES =
  /^[\s\-?:,[\]{}#&*!|>'"%@`]|[:#]\s|\s$|^$|^(true|false|null|yes|no|on|off|~|[-+]?\d[\d_.eE+-]*)$/i;

/** A YAML scalar, double-quoted with escapes when needed. */
export function yamlString(s: string): string {
  if (!NEEDS_QUOTES.test(s) && !/[\n\r\t\\"]/.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

const yamlList = (items: string[]) =>
  items.length === 0 ? '[]' : `\n${items.map((i) => `  - ${yamlString(i)}`).join('\n')}`;

/** The front-matter block plus body for one note. */
export function noteToMarkdown(n: ExportNote, collectionPath: string, tagNames: string[]): string {
  const fm = [
    '---',
    `id: ${n.id}`,
    `title: ${yamlString(n.title)}`,
    `created: ${n.createdAt}`,
    `updated: ${n.updatedAt}`,
    `collection: ${collectionPath ? yamlString(collectionPath) : 'null'}`,
    `tags: ${yamlList(tagNames)}`,
    `links: ${yamlList(n.links)}`,
    ...(n.isPinned ? ['pinned: true'] : []),
    '---',
    '',
  ].join('\n');
  return `${fm}${n.bodyMd.endsWith('\n') || !n.bodyMd ? n.bodyMd : `${n.bodyMd}\n`}`;
}

/** Safe, readable file or folder name; never empty, no path separators. */
export function slug(name: string, fallback = 'untitled'): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return s || fallback;
}

/** Assigns unique paths: `Collection/Sub/Title.md`, with " (2)" on clashes. */
export function assignPaths(
  notes: ExportNote[],
  collectionPathOf: (id: string | null) => string[],
): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const n of notes) {
    const dir = collectionPathOf(n.collectionId)
      .map((c) => slug(c, 'collection'))
      .join('/');
    const base = slug(n.title);
    let candidate = `${dir ? `${dir}/` : ''}${base}.md`;
    for (let i = 2; used.has(candidate.toLowerCase()); i += 1) {
      candidate = `${dir ? `${dir}/` : ''}${base} (${i}).md`;
    }
    used.add(candidate.toLowerCase());
    out.set(n.id, candidate);
  }
  return out;
}

export interface BundleIndex {
  format: 'nexus-markdown-bundle';
  version: number;
  exportedAt: string;
  notes: { id: string; title: string; path: string }[];
  attachments: { id: string; noteId: string | null; filename: string; path: string | null }[];
  collections: ExportCollection[];
  tags: ExportTag[];
}

export interface JsonExport {
  format: 'nexus-json';
  version: number;
  exportedAt: string;
  notes: (ExportNote & {
    versions?: { rev: number; title: string; bodyMd: string; createdAt: string }[];
  })[];
  collections: ExportCollection[];
  tags: ExportTag[];
  attachments: ExportAttachment[];
}
