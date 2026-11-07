import type { Collection } from '../../../src/data/repos';
import {
  childrenByParent,
  depthOf,
  descendants,
  flattenTree,
  heightOf,
} from '../../../src/features/collections/tree';

const c = (id: string, parentId: string | null, sortOrder = 0, name = id): Collection => ({
  id,
  parentId,
  name,
  icon: null,
  sortOrder,
  noteCount: 0,
  serverRev: 0,
});

// work ─┬ admin
//       └ proj ─ alpha
// home
const all = [
  c('home', null, 1),
  c('work', null, 0),
  c('proj', 'work', 0, 'Projects'),
  c('admin', 'work', 0, 'Admin'),
  c('alpha', 'proj'),
];
const cycle = [c('a', 'b'), c('b', 'a')];

describe('childrenByParent', () => {
  it('groups by parent, ordered by sort order then name', () => {
    const map = childrenByParent(all);
    expect(map.get(null)!.map((x) => x.id)).toEqual(['work', 'home']);
    expect(map.get('work')!.map((x) => x.id)).toEqual(['admin', 'proj']);
    expect(map.has('alpha')).toBe(false);
  });
});

describe('flattenTree', () => {
  it('shows only roots when nothing is expanded', () => {
    expect(flattenTree(all, new Set())).toEqual([
      { collection: all[1], depth: 0, hasChildren: true },
      { collection: all[0], depth: 0, hasChildren: false },
    ]);
  });

  it('walks expanded nodes depth-first', () => {
    const rows = flattenTree(all, new Set(['work', 'proj']));
    expect(rows.map((r) => [r.collection.id, r.depth])).toEqual([
      ['work', 0],
      ['admin', 1],
      ['proj', 1],
      ['alpha', 2],
      ['home', 0],
    ]);
  });
});

describe('descendants', () => {
  it('collects every id below a collection', () => {
    expect([...descendants(all, 'work')].sort()).toEqual(['admin', 'alpha', 'proj']);
    expect(descendants(all, 'alpha').size).toBe(0);
  });

  it('survives a cycle', () => {
    expect([...descendants(cycle, 'a')].sort()).toEqual(['a', 'b']);
  });
});

describe('depthOf', () => {
  it('is 1 at the root and 0 for none', () => {
    expect(depthOf(all, 'work')).toBe(1);
    expect(depthOf(all, 'alpha')).toBe(3);
    expect(depthOf(all, null)).toBe(0);
    expect(depthOf(all, 'missing')).toBe(0);
  });

  it('caps a cycle at 64', () => {
    expect(depthOf(cycle, 'a')).toBe(64);
  });
});

describe('heightOf', () => {
  it('measures the subtree', () => {
    expect(heightOf(all, 'alpha')).toBe(1);
    expect(heightOf(all, 'proj')).toBe(2);
    expect(heightOf(all, 'work')).toBe(3);
  });

  it('stops descending a cycle', () => {
    expect(heightOf(cycle, 'a')).toBe(66);
  });
});
