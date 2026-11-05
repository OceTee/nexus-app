/** A half-open character range `[start, end)` inside a Markdown body. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

/**
 * Finds fenced code blocks (``` or ~~~, at least three, up to three spaces of
 * indent) and inline code spans. Text inside these ranges is code, not prose.
 * Linear in the length of the body.
 */
export function findCodeRanges(body: string): Range[] {
  const ranges: Range[] = [];
  const fences = findFencedBlocks(body);
  let fenceIdx = 0;

  let i = 0;
  while (i < body.length) {
    const fence = fences[fenceIdx];
    if (fence && i >= fence.start) {
      ranges.push(fence);
      i = fence.end;
      fenceIdx++;
      continue;
    }
    if (body[i] === '`') {
      // Inline code: a run of N backticks closed by the next run of exactly N.
      const runEnd = runOf(body, i, '`');
      const n = runEnd - i;
      const limit = fence ? fence.start : body.length;
      const close = findBacktickRun(body, runEnd, n, limit);
      if (close !== -1) {
        ranges.push({ start: i, end: close + n });
        i = close + n;
        continue;
      }
      i = runEnd;
      continue;
    }
    i++;
  }
  return ranges;
}

function runOf(s: string, from: number, ch: string): number {
  let j = from;
  while (j < s.length && s[j] === ch) j++;
  return j;
}

function findBacktickRun(s: string, from: number, n: number, limit: number): number {
  let j = from;
  while (j < limit) {
    if (s[j] === '`') {
      const end = runOf(s, j, '`');
      if (end - j === n) return j;
      j = end;
    } else {
      j++;
    }
  }
  return -1;
}

function findFencedBlocks(body: string): Range[] {
  const blocks: Range[] = [];
  let open: { start: number; char: string; len: number } | null = null;
  let lineStart = 0;

  while (lineStart <= body.length) {
    const nl = body.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? body.length : nl;
    const line = body.slice(lineStart, lineEnd);
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);

    if (open === null) {
      if (fence?.[1]) {
        const marker = fence[1];
        open = { start: lineStart, char: marker[0] ?? '`', len: marker.length };
      }
    } else {
      // A closing fence uses the same character, is at least as long, and has nothing after it.
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close?.[1] && close[1][0] === open.char && close[1].length >= open.len) {
        blocks.push({ start: open.start, end: lineEnd });
        open = null;
      }
    }

    if (nl === -1) break;
    lineStart = nl + 1;
  }
  // An unclosed fence runs to the end of the document (CommonMark behaviour).
  if (open !== null) blocks.push({ start: open.start, end: body.length });
  return blocks;
}

/** True if `index` falls inside any of the (sorted, non-overlapping) ranges. */
export function inRanges(ranges: readonly Range[], index: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (!r) break;
    if (index < r.start) hi = mid - 1;
    else if (index >= r.end) lo = mid + 1;
    else return true;
  }
  return false;
}
