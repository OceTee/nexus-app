import { createHash } from 'node:crypto';
import { excerpt, stripMarkdown, wordCount } from '@nexus/shared';

/** Hash of the versioned content; equal hashes mean an upsert changes nothing (BR-03). */
export function contentHash(title: string, bodyMd: string): string {
  return createHash('sha256').update(`${title}\u0000${bodyMd}`).digest('hex');
}

/** Columns computed from a note's Markdown on every accepted write. */
export function deriveNoteFields(title: string, bodyMd: string) {
  return {
    bodyText: stripMarkdown(bodyMd),
    excerpt: excerpt(bodyMd),
    wordCount: wordCount(bodyMd),
    contentHash: contentHash(title, bodyMd),
  };
}

/** ISO string for a timestamp column (Drizzle returns Postgres text in `string` mode). */
export function iso(value: string | Date): string;
export function iso(value: string | Date | null): string | null;
export function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
