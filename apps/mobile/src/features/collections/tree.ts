import type { Collection } from '@/data/repos';

export interface TreeNode {
  collection: Collection;
  depth: number;
  hasChildren: boolean;
}

/** Children of each parent, ordered by sort order then name. */
export function childrenByParent(all: Collection[]): Map<string | null, Collection[]> {
  const map = new Map<string | null, Collection[]>();
  for (const c of all) {
    const list = map.get(c.parentId) ?? [];
    list.push(c);
    map.set(c.parentId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  return map;
}

/** Depth-first rows for a tree list, showing children of expanded nodes only. */
export function flattenTree(all: Collection[], expanded: ReadonlySet<string>): TreeNode[] {
  const kids = childrenByParent(all);
  const out: TreeNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of kids.get(parent) ?? []) {
      const hasChildren = (kids.get(c.id)?.length ?? 0) > 0;
      out.push({ collection: c, depth, hasChildren });
      if (hasChildren && expanded.has(c.id)) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Every id below a collection (to keep a collection out of its own subtree). */
export function descendants(all: Collection[], id: string): Set<string> {
  const kids = childrenByParent(all);
  const out = new Set<string>();
  const walk = (p: string) => {
    for (const c of kids.get(p) ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** Depth of a collection, 1 at the root. */
export function depthOf(all: Collection[], id: string | null): number {
  const byId = new Map(all.map((c) => [c.id, c]));
  let d = 0;
  let cur = id ? byId.get(id) : undefined;
  while (cur && d < 64) {
    d += 1;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return d;
}

/** Height of a subtree, 1 for a collection without children. */
export function heightOf(all: Collection[], id: string): number {
  const kids = childrenByParent(all);
  const h = (p: string, guard: number): number =>
    guard > 64 ? 1 : 1 + Math.max(0, ...(kids.get(p) ?? []).map((c) => h(c.id, guard + 1)));
  return h(id, 0);
}
