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
  updatedAt?: string;
  collectionId?: string | null;
}

export interface SearchFilters {
  tagId?: string;
  collectionId?: string;
  /** ISO date: only notes edited since. */
  since?: string;
  hasAttachment?: boolean;
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

  /**
   * Notes whose text mentions this note's title without linking it (S-14,
   * "Unlinked mentions"), via an FTS phrase query on the title.
   */
  async unlinkedMentions(noteId: string, title: string): Promise<Backlink[]> {
    const q = ftsQuery(title, false);
    if (!q) return [];
    const rows = await this.db().getAllAsync<{ id: string; title: string; body_md: string }>(
      `SELECT n.id, n.title, n.body_md FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
       WHERE notes_fts MATCH ? AND n.deleted_at IS NULL AND n.id != ?
         AND NOT EXISTS (SELECT 1 FROM note_links l
                         WHERE l.source_note_id = n.id AND l.target_note_id = ?)
       ORDER BY n.updated_at DESC LIMIT 20`,
      [`body_text : (${q.split(' ').join(' + ')})`, noteId, noteId],
    );
    const needle = title.toLowerCase();
    return rows.flatMap((r) => {
      const at = r.body_md.toLowerCase().indexOf(needle);
      return at < 0
        ? []
        : [{ noteId: r.id, title: r.title, context: sentenceAround(r.body_md, at) }];
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

  /**
   * Ranked search with snippets (S-25); the title weighs 4x the body (bm25).
   * Filters narrow by tag, collection, edit date and attachments. If FTS still
   * rejects the query, it is re-run as one quoted phrase.
   */
  async search(input: string, filters: SearchFilters = {}, limit = 50): Promise<SearchHit[]> {
    const q = ftsQuery(input);
    if (!q) return [];
    try {
      return await this.runSearch(q, filters, limit);
    } catch {
      const phrase = `"${input.replace(/"/g, '').trim()}"`;
      return phrase === '""' ? [] : this.runSearch(phrase, filters, limit);
    }
  }

  private async runSearch(q: string, f: SearchFilters, limit: number): Promise<SearchHit[]> {
    const where = ['notes_fts MATCH ?', 'n.deleted_at IS NULL'];
    const params: (string | number)[] = [q];
    if (f.tagId) {
      where.push(
        'EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag_id = ? AND t.deleted_at IS NULL)',
      );
      params.push(f.tagId);
    }
    if (f.collectionId) {
      where.push('n.collection_id = ?');
      params.push(f.collectionId);
    }
    if (f.since) {
      where.push('n.updated_at >= ?');
      params.push(f.since);
    }
    if (f.hasAttachment) {
      where.push(
        'EXISTS (SELECT 1 FROM attachments a WHERE a.note_id = n.id AND a.deleted_at IS NULL)',
      );
    }
    params.push(limit);
    const rows = await this.db().getAllAsync<{
      id: string;
      title: string;
      snippet: string;
      rank: number;
      updated_at: string;
      collection_id: string | null;
    }>(
      `SELECT n.id, n.title, n.updated_at, n.collection_id,
              snippet(notes_fts, 1, '«', '»', '…', 12) AS snippet,
              bm25(notes_fts, 4.0, 1.0) AS rank
       FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
       WHERE ${where.join(' AND ')}
       ORDER BY rank LIMIT ?`,
      params,
    );
    return rows.map((r) => ({
      noteId: r.id,
      title: r.title,
      snippet: r.snippet,
      rank: Number(r.rank),
      updatedAt: r.updated_at,
      collectionId: r.collection_id,
    }));
  }
}
