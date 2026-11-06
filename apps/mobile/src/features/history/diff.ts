export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Line-level diff (LCS) from `before` to `after` for S-12 and S-13. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // Very large inputs fall back to a plain replace to keep the UI responsive.
  if (a.length * b.length > 4_000_000) {
    return [
      ...a.map((text) => ({ kind: 'removed' as const, text })),
      ...b.map((text) => ({ kind: 'added' as const, text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'removed', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'added', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++]! });
  while (j < m) out.push({ kind: 'added', text: b[j++]! });
  return out;
}

/** Word delta for history rows: "+12 / −40". */
export function wordDelta(before: string, after: string): string {
  const count = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
  const d = count(after) - count(before);
  return d === 0 ? '±0' : d > 0 ? `+${d}` : `−${-d}`;
}

/**
 * Merge draft for S-13: the server text, then the paragraphs only this device
 * had, under a `---` rule.
 */
export function mergeDraft(server: string, mine: string): string {
  const paras = (s: string) =>
    s
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
  const have = new Set(paras(server));
  const extra = paras(mine).filter((p) => !have.has(p));
  return extra.length === 0 ? server : `${server.trimEnd()}\n\n---\n\n${extra.join('\n\n')}\n`;
}
