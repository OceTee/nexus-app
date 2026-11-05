import { findCodeRanges, inRanges } from './codeRanges';
import { normaliseTitle } from './normaliseTitle';

/** Maximum length of a wiki-link target title (matches the note title limit). */
export const WIKI_LINK_MAX_TITLE = 200;

export interface WikiLink {
  /** Target title as written, e.g. `Beta Gamma` in `[[Beta Gamma|shown]]`. */
  readonly target: string;
  /** Normalised target used to resolve the link (`normaliseTitle(target)`). */
  readonly targetNorm: string;
  /** Text to display: the alias after `|`, or the target when there is no alias. */
  readonly display: string;
  /** Offset of the opening `[[` in the body. */
  readonly start: number;
  /** Offset just after the closing `]]`. */
  readonly end: number;
}

/**
 * Extracts `[[Target]]` and `[[Target|alias]]` links from a Markdown body.
 *
 * - Links inside fenced code blocks and inline code are ignored (TDD T-02).
 * - A link may not span lines, nest `[[`, or have an empty target.
 * - Implemented as a linear scanner, not a backtracking regex (threat TM-10).
 *
 * Every occurrence is returned in document order; callers that store links
 * de-duplicate by `targetNorm` (see `uniqueLinkTargets`).
 */
export function parseWikiLinks(body: string): WikiLink[] {
  const links: WikiLink[] = [];
  if (!body.includes('[[')) return links;

  const code = findCodeRanges(body);
  let i = 0;

  while (i < body.length - 1) {
    const open = body.indexOf('[[', i);
    if (open === -1) break;
    if (inRanges(code, open)) {
      i = open + 2;
      continue;
    }

    const inner = open + 2;
    let j = inner;
    let pipe = -1;
    let closed = -1;
    while (j < body.length) {
      const ch = body[j];
      if (ch === '\n' || ch === '\r') break;
      if (ch === '[' && body[j + 1] === '[') break; // nested opener: restart from here
      if (ch === ']' && body[j + 1] === ']') {
        closed = j;
        break;
      }
      if (ch === '|' && pipe === -1) pipe = j;
      j++;
    }

    if (closed === -1) {
      // No valid close on this line; resume scanning after the opener.
      i = j > inner ? j : inner;
      continue;
    }

    const rawTarget = body.slice(inner, pipe === -1 ? closed : pipe);
    const target = rawTarget.trim().replace(/\s+/g, ' ');
    const alias = pipe === -1 ? '' : body.slice(pipe + 1, closed).trim();

    if (target.length > 0 && target.length <= WIKI_LINK_MAX_TITLE) {
      links.push({
        target,
        targetNorm: normaliseTitle(target),
        display: alias || target,
        start: open,
        end: closed + 2,
      });
    }
    i = closed + 2;
  }
  return links;
}

/** Distinct normalised targets in first-seen order, as stored in `note_links`. */
export function uniqueLinkTargets(body: string): string[] {
  const seen = new Set<string>();
  for (const link of parseWikiLinks(body)) seen.add(link.targetNorm);
  return [...seen];
}
