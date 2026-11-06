// Links, backlinks, wiki-link autocomplete and full-text search, all local
// (TDD Section G, Local database requirements).

import { parseWikiLinks, sentenceAround } from '@nexus/shared';
import type { SqlDb } from '../../infra/sql';

export interface Backlink {
  noteId: string;
  title: string;
  context: string;
}

export interface SearchHit {
  noteId: string;
  title: string;
  snippet: string;
  rank: number;
}

/**
 * Turns user input into a safe FTS5 query: every word is quoted, so FTS
 * syntax characters are matched literally, and the last word matches as a
 * prefix. Returns null when there is nothing to search for.
 */
export function ftsQuery(input: string, prefixLast = true): string | null {
  const words = input
    .normalize('NFC')
    .split(/\s+/)
    .map((w) => w.replace(/"/g, ''))
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return null;
  return words.map((w, i) => `"${w}"${prefixLast && i === words.length - 1 ? '*' : ''}`).join(' ');
}

export class LinksRepo {
  constructor(private readonly db: () => SqlDb) {}

  async backlinks(noteId: string): Promise<Backlink[]> {
    const rows = await this.db().getAllAsync<{
      id: string;
      title: string;
      body_md: string;
      norm: string;
    }>(
      `SELECT n.id, n.title, n.body_md, l.target_title_norm AS norm
       FROM note_links l JOIN notes n ON n.id = l.source_note_id
       WHERE l.target_note_id = ? AND n.deleted_at IS NULL ORDER BY n.updated_at DESC`,
      [noteId],
    );
    return rows.map((r) => {
      const link = parseWikiLinks(r.body_md).find((l) => l.targetNorm === r.norm);
      return {
        noteId: r.id,
        title: r.title,
        context: link ? sentenceAround(r.body_md, link.start) : '',
      };
    });
  }

  /** Note titles starting with the typed text, for `[[` autocomplete (8 results). */
  async autocomplete(prefix: string): Promise<{ id: string; title: string }[]> {
    const q = ftsQuery(prefix);
    if (!q) return [];
    return this.db().getAllAsync<{ id: string; title: string }>(
      `SELECT id, title FROM notes WHERE rowid IN (
         SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)
       AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 8`,
      [`title : (${q})`],
    );
  }

  /** Ranked search with snippets; the title weighs 4× the body (bm25). */
  async search(input: string, limit = 50): Promise<SearchHit[]> {
    const q = ftsQuery(input);
    if (!q) return [];
    const rows = await this.db().getAllAsync<{
      id: string;
      title: string;
      snippet: string;
      rank: number;
    }>(
      `SELECT n.id, n.title, snippet(notes_fts, 1, '«', '»', '…', 12) AS snippet,
              bm25(notes_fts, 4.0, 1.0) AS rank
       FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
       WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
       ORDER BY rank LIMIT ?`,
      [q, limit],
    );
    return rows.map((r) => ({
      noteId: r.id,
      title: r.title,
      snippet: r.snippet,
      rank: Number(r.rank),
    }));
  }
}
