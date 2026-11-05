/** Maximum excerpt length in characters (TDD T-07). */
export const EXCERPT_MAX = 240;

/**
 * Converts Markdown to plain prose for excerpts, word counts and search.
 *
 * - Fenced code blocks keep their contents but lose the fences.
 * - Headings, block quotes, list markers, emphasis, inline code ticks,
 *   tables pipes, horizontal rules and HTML tags are removed.
 * - Links keep their text; images keep their alt text; `[[Target|alias]]`
 *   keeps the alias (or the target).
 * - Whitespace is collapsed to single spaces.
 */
export function stripMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }
    let line = raw;
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) continue; // horizontal rule
    if (/^ {0,3}\|?[\s:-]*\|[\s|:-]*$/.test(line) && line.includes('-')) continue; // table divider
    line = line
      .replace(/^ {0,3}#{1,6}\s+/, '') // headings
      .replace(/\s+#+\s*$/, '') // closing heading hashes
      .replace(/^(\s*>)+\s?/, '') // block quotes
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '') // list markers and task boxes
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
      .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2') // wiki-link with alias
      .replace(/\[\[([^\]\n]+)\]\]/g, '$1') // wiki-link
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
      .replace(/<[^>\n]+>/g, '') // HTML tags
      .replace(/`+([^`]*)`+/g, '$1') // inline code
      .replace(/(\*\*|__)(.+?)\1/g, '$2') // bold
      .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2') // italic
      .replace(/~~(.+?)~~/g, '$1') // strikethrough
      .replace(/\|/g, ' '); // table cells
    out.push(line);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Counts words in the prose of a Markdown body, excluding Markdown syntax. */
export function wordCount(md: string): number {
  const text = stripMarkdown(md);
  if (!text) return 0;
  // Words contain at least one letter or digit; stray punctuation is not a word.
  return text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * A plain-text preview of at most `max` characters (default 240), cut at a word
 * boundary where possible and ending with an ellipsis when truncated.
 */
export function excerpt(md: string, max: number = EXCERPT_MAX): string {
  const text = stripMarkdown(md);
  if (text.length <= max) return text;
  const room = max - 1; // leave space for the ellipsis
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}
