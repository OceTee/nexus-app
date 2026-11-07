import {
  activeFilterCount,
  DEFAULT_FILTERS,
  useGraphStore,
} from '../../../src/features/graph/store';

beforeEach(() => {
  useGraphStore.setState({
    filters: DEFAULT_FILTERS,
    view: null,
    pinned: {},
    listView: false,
    legend: false,
  });
});

describe('activeFilterCount', () => {
  it('is zero for the defaults', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it('counts each filter that differs from the default', () => {
    expect(
      activeFilterCount({
        tagIds: ['t1', 't2'],
        collectionId: 'c1',
        showOrphans: false,
        tagEdges: true,
      }),
    ).toBe(4);
  });
});

describe('useGraphStore', () => {
  it('merges filter patches and resets them', () => {
    const s = useGraphStore.getState();
    s.setFilters({ tagIds: ['t1'] });
    s.setFilters({ showOrphans: false });
    expect(useGraphStore.getState().filters).toEqual({
      ...DEFAULT_FILTERS,
      tagIds: ['t1'],
      showOrphans: false,
    });
    useGraphStore.getState().resetFilters();
    expect(useGraphStore.getState().filters).toBe(DEFAULT_FILTERS);
  });

  it('toggles pins on and off', () => {
    useGraphStore.getState().togglePin('n1', { x: 1, y: 2 });
    expect(useGraphStore.getState().pinned).toEqual({ n1: { x: 1, y: 2 } });
    useGraphStore.getState().togglePin('n1', { x: 9, y: 9 });
    expect(useGraphStore.getState().pinned).toEqual({});
  });

  it('saves the view and UI toggles', () => {
    const s = useGraphStore.getState();
    s.saveView({ scale: 2, x: 10, y: -5 });
    s.setListView(true);
    s.setLegend(true);
    expect(useGraphStore.getState()).toMatchObject({
      view: { scale: 2, x: 10, y: -5 },
      listView: true,
      legend: true,
    });
  });
});
