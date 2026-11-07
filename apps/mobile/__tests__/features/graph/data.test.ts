import { repos } from '../../../src/data/repos';
import { layoutGraph, loadGraph, radiusFor } from '../../../src/features/graph/data';
import { DEFAULT_FILTERS, type GraphFilters } from '../../../src/features/graph/store';
import { setDbForTests } from '../../../src/infra/db';
import { createTestDb } from '../../../src/test/nodeSqlite';

// d3-force and its dependencies ship ES modules that Jest does not transform;
// load their UMD builds instead.
jest.mock('d3-force', () =>
  jest.requireActual('../../../../../node_modules/d3-force/dist/d3-force.js'),
);
jest.mock('d3-quadtree', () =>
  jest.requireActual('../../../../../node_modules/d3-quadtree/dist/d3-quadtree.js'),
);
jest.mock('d3-dispatch', () =>
  jest.requireActual('../../../../../node_modules/d3-dispatch/dist/d3-dispatch.js'),
);
jest.mock('d3-timer', () =>
  jest.requireActual('../../../../../node_modules/d3-timer/dist/d3-timer.js'),
);

const filters = (over: Partial<GraphFilters> = {}): GraphFilters => ({
  ...DEFAULT_FILTERS,
  ...over,
});

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe('loadGraph', () => {
  let a: string, b: string, c: string, lonely: string, tagged: string, work: string;

  beforeEach(async () => {
    setDbForTests(await createTestDb());
    work = await repos.collections.save({ name: 'Work' });
    // Targets first so the links resolve.
    b = (await repos.notes.save({ title: 'Beta', bodyMd: 'beta', collectionId: work })).id;
    c = (await repos.notes.save({ title: 'Gamma', bodyMd: 'links [[Beta]]' })).id;
    a = (await repos.notes.save({ title: 'Alpha', bodyMd: '[[Beta]] [[Gamma]] [[Alpha]]' })).id;
    lonely = (await repos.notes.save({ title: '', bodyMd: 'nothing' })).id;
    tagged = (await repos.notes.save({ title: 'Tagged', bodyMd: '' })).id;
    const tag = await repos.tags.save({ name: 'shared' });
    await repos.tags.setMembership(tagged, tag, true);
    await repos.tags.setMembership(lonely, tag, true);
  });

  it('returns notes and de-duplicated link edges with degrees', async () => {
    const g = await loadGraph(filters());
    expect(g.total).toBe(5);
    expect(ids(g.nodes)).toEqual(
      ids([{ id: a }, { id: b }, { id: c }, { id: lonely }, { id: tagged }]),
    );
    expect(g.edges).toHaveLength(3);
    expect(g.edges.every((e) => e.kind === 'link')).toBe(true);
    const deg = Object.fromEntries(g.nodes.map((n) => [n.id, n.degree]));
    expect(deg).toMatchObject({ [a]: 2, [b]: 2, [c]: 2, [lonely]: 0 });
    expect(g.nodes.find((n) => n.id === lonely)!.title).toBe('Untitled');
  });

  it('hides orphans when asked', async () => {
    const g = await loadGraph(filters({ showOrphans: false }));
    expect(ids(g.nodes)).toEqual(ids([{ id: a }, { id: b }, { id: c }]));
  });

  it('adds tag edges between notes sharing a tag', async () => {
    const g = await loadGraph(filters({ tagEdges: true, showOrphans: false }));
    expect(g.edges.filter((e) => e.kind === 'tag')).toEqual([
      expect.objectContaining({ kind: 'tag' }),
    ]);
    expect(ids(g.nodes)).toContain(lonely);
  });

  it('filters by collection and by tag', async () => {
    expect(ids((await loadGraph(filters({ collectionId: work }))).nodes)).toEqual([b]);
    const [tag] = await repos.tags.list();
    const g = await loadGraph(filters({ tagIds: [tag!.id] }));
    expect(ids(g.nodes)).toEqual(ids([{ id: lonely }, { id: tagged }]));
    expect(g.edges).toEqual([]);
  });

  it('skips tag edges for very common tags', async () => {
    const tag = await repos.tags.save({ name: 'common' });
    for (let i = 0; i < 31; i += 1) {
      const n = await repos.notes.save({ title: `N${i}`, bodyMd: '' });
      await repos.tags.setMembership(n.id, tag, true);
    }
    const g = await loadGraph(filters({ tagEdges: true, tagIds: [tag] }));
    expect(g.nodes).toHaveLength(31);
    expect(g.edges).toEqual([]);
  });
});

describe('radiusFor', () => {
  it('grows with degree up to a cap', () => {
    expect(radiusFor(0)).toBe(5);
    expect(radiusFor(4)).toBeCloseTo(10.2);
    expect(radiusFor(1000)).toBe(18);
  });
});

describe('layoutGraph', () => {
  // d3 schedules (and immediately stops) a simulation timer; keep it off the real clock.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const data = {
    nodes: [
      { id: 'a', title: 'A', excerpt: '', degree: 1 },
      { id: 'b', title: 'B', excerpt: '', degree: 1 },
      { id: 'c', title: 'C', excerpt: '', degree: 0 },
    ],
    edges: [{ source: 'a', target: 'b', kind: 'link' as const }],
    total: 3,
  };

  it('positions every node with a radius, deterministically', () => {
    const first = layoutGraph(data, {});
    expect(first.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    for (const n of first) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
      expect(n.r).toBe(radiusFor(n.degree));
    }
    expect(layoutGraph(data, {})).toEqual(first);
  });

  it('keeps pinned nodes where they were put', () => {
    const out = layoutGraph(data, { a: { x: 123, y: -45 } });
    expect(out[0]).toMatchObject({ id: 'a', x: 123, y: -45 });
  });

  it('handles an empty graph', () => {
    expect(layoutGraph({ nodes: [], edges: [], total: 0 }, {})).toEqual([]);
  });
});
