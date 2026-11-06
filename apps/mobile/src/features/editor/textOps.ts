// Pure text operations for the editor toolbar and wiki-link autocomplete
// (S-09). Each takes the text and selection and returns the next text and
// selection, so they are easy to reason about and undo.

export interface Selection {
  start: number;
  end: number;
}

export interface Edit {
  text: string;
  selection: Selection;
}

/** Wraps the selection in markers (`**`, `_`, `` ` ``), or unwraps it when already wrapped. */
export function wrap(
  text: string,
  sel: Selection,
  left: string,
  right = left,
  placeholder = 'text',
): Edit {
  const before = text.slice(0, sel.start);
  const inner = text.slice(sel.start, sel.end);
  const after = text.slice(sel.end);
  if (before.endsWith(left) && after.startsWith(right)) {
    return {
      text: before.slice(0, -left.length) + inner + after.slice(right.length),
      selection: { start: sel.start - left.length, end: sel.end - left.length },
    };
  }
  const body = inner || placeholder;
  return {
    text: before + left + body + right + after,
    selection: { start: sel.start + left.length, end: sel.start + left.length + body.length },
  };
}

/** Start offset of the line containing `pos`. */
function lineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

/**
 * Toggles a prefix (`# `, `- `, `- [ ] `, `1. `) on every line touched by the
 * selection. Other list or heading prefixes on the line are replaced.
 */
export function togglePrefix(text: string, sel: Selection, prefix: string): Edit {
  const from = lineStart(text, sel.start);
  const to = text.indexOf('\n', sel.end);
  const end = to < 0 ? text.length : to;
  const lines = text.slice(from, end).split('\n');
  const existing = /^(#{1,6} |- \[[ xX]\] |[-*+] |\d+\. )/;
  const allHave = lines.every((l) => l.startsWith(prefix));
  let delta = 0;
  let firstDelta = 0;
  const next = lines.map((l, i) => {
    const stripped = l.replace(existing, '');
    const removed = l.length - stripped.length;
    const out = allHave ? stripped : prefix + stripped;
    const d = out.length - l.length;
    if (i === 0) firstDelta = allHave ? -removed : prefix.length - removed;
    delta += d;
    return out;
  });
  return {
    text: text.slice(0, from) + next.join('\n') + text.slice(end),
    selection: {
      start: Math.max(from, sel.start + firstDelta),
      end: Math.max(from, sel.end + delta),
    },
  };
}

/** Inserts text at the selection, replacing it, with the cursor after the insert. */
export function insert(
  text: string,
  sel: Selection,
  value: string,
  cursorOffset = value.length,
): Edit {
  return {
    text: text.slice(0, sel.start) + value + text.slice(sel.end),
    selection: { start: sel.start + cursorOffset, end: sel.start + cursorOffset },
  };
}

/** Inserts a fenced code block, or inline code for a selection on one line. */
export function code(text: string, sel: Selection): Edit {
  const inner = text.slice(sel.start, sel.end);
  if (inner && !inner.includes('\n')) return wrap(text, sel, '`');
  const atLineStart = sel.start === lineStart(text, sel.start);
  const open = `${atLineStart ? '' : '\n'}\`\`\`\n`;
  return {
    text: text.slice(0, sel.start) + open + inner + '\n```\n' + text.slice(sel.end),
    selection: { start: sel.start + open.length, end: sel.start + open.length + inner.length },
  };
}

/**
 * The open `[[query` immediately before the cursor, if any: the start of `[[`
 * and the text typed so far. Closed links, line breaks and nested `[[` end it.
 */
export function activeWikiQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(Math.max(0, cursor - 202), cursor);
  const open = before.lastIndexOf('[[');
  if (open < 0) return null;
  const query = before.slice(open + 2);
  if (/[\]\n[|]/.test(query)) return null;
  return { start: cursor - before.length + open, query };
}

/** Replaces `[[query` (and an already-typed `]]`) with the chosen title. */
export function completeWiki(text: string, start: number, cursor: number, title: string): Edit {
  const rest = text.slice(cursor);
  const tail = rest.startsWith(']]') ? rest.slice(2) : rest;
  const link = `[[${title}]]`;
  return {
    text: text.slice(0, start) + link + tail,
    selection: { start: start + link.length, end: start + link.length },
  };
}
