import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Graph from '../../../app/(app)/(tabs)/graph/index';
import { repos } from '../../../src/data/repos';
import { DEFAULT_FILTERS, useGraphStore } from '../../../src/features/graph/store';
import { freshDb, lastToast, renderScreen, resetStores, stub } from '../screen-helpers/setup';

// d3-force and its dependencies ship ES modules that Jest does not transform.
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
jest.mock('../../../src/features/graph/GraphCanvas', () =>
  jest.requireActual('../screen-helpers/graphCanvasMock'),
);

const routes = {
  graph: Graph,
  'graph/filters': stub('Filters'),
  'note/[noteId]': stub('Note'),
};
const show = (url = '/graph') => renderScreen(routes, url);

let alpha: string;
let beta: string;

beforeEach(async () => {
  resetStores();
  useGraphStore.setState({
    filters: DEFAULT_FILTERS,
    view: null,
    pinned: {},
    listView: false,
    legend: false,
  });
  await freshDb();
});

const seedLinked = async () => {
  beta = (await repos.notes.save({ title: 'Beta', bodyMd: 'the target' })).id;
  alpha = (await repos.notes.save({ title: 'Alpha', bodyMd: 'see [[Beta]]' })).id;
};

describe('Graph tab', () => {
  it('explains the empty graph', async () => {
    await show();
    expect(await screen.findByText('No connections yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('treats unlinked notes as an empty graph', async () => {
    await repos.notes.save({ title: 'Lonely', bodyMd: '' });
    await show();
    expect(await screen.findByText('No connections yet')).toBeTruthy();
  });

  it('pre-applies a tag filter from the link and offers to clear it', async () => {
    await seedLinked();
    await show('/graph?tag=missing-tag');
    expect(await screen.findByText('No connections yet')).toBeTruthy();
    expect(useGraphStore.getState().filters.tagIds).toEqual(['missing-tag']);
    await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
    expect(useGraphStore.getState().filters).toEqual(DEFAULT_FILTERS);
    expect(await screen.findByRole('button', { name: 'Node Alpha' })).toBeTruthy();
  });

  describe('with linked notes', () => {
    beforeEach(seedLinked);

    it('selects a node, shows its card and opens the note', async () => {
      const r = await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Node Alpha' }));
      expect(await screen.findByText('see Beta')).toBeTruthy();
      expect(screen.getByText('1 connection')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Open note' }));
      expect(await screen.findByText('Note screen')).toBeTruthy();
      expect(r.getPathname()).toBe(`/note/${alpha}`);
    });

    it('closes the card', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Node Beta' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Open note' })).toBeNull());
    });

    it('opens a note straight from the canvas', async () => {
      const r = await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Open node Beta' }));
      expect(await screen.findByText('Note screen')).toBeTruthy();
      expect(r.getPathname()).toBe(`/note/${beta}`);
    });

    it('pins and unpins a node in place', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Pin node Alpha' }));
      expect(lastToast()).toBe('Pinned in place');
      expect(useGraphStore.getState().pinned[alpha]).toBeDefined();
      await fireEvent.press(screen.getByRole('button', { name: 'Node Alpha' }));
      expect(await screen.findByText('1 connection · pinned')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Pin node Alpha' }));
      expect(lastToast()).toBe('Unpinned');
    });

    it('saves the zoom and pan', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Save view' }));
      expect(useGraphStore.getState().view).toEqual({ scale: 2, x: 1, y: 1 });
    });

    it('finds a note by title and centres on it', async () => {
      await show();
      const find = await screen.findByLabelText('Find a note in the graph');
      await fireEvent.changeText(find, 'alp');
      expect(await screen.findByText('Alpha (match)')).toBeTruthy();
      await fireEvent(find, 'submitEditing');
      expect(await screen.findByText(`Focus ${alpha}`)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open note' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
      expect(screen.getByLabelText('Find a note in the graph').props.value).toBe('');
    });

    it('says when no title matches', async () => {
      await show();
      const find = await screen.findByLabelText('Find a note in the graph');
      await fireEvent.changeText(find, 'zzz');
      await fireEvent(find, 'submitEditing');
      expect(lastToast()).toBe('No note with that title in the graph');
    });

    it('toggles the legend', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Show legend' }));
      expect(await screen.findByText('● Note (bigger = more links)')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Hide legend' }));
      await waitFor(() => expect(screen.queryByText('● Note (bigger = more links)')).toBeNull());
    });

    it('opens filters, with the active count in the label', async () => {
      useGraphStore.getState().setFilters({ tagEdges: true });
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Filters, 1 active' }));
      expect(await screen.findByText('Filters screen')).toBeTruthy();
    });

    it('shows the graph as a list sorted by connections', async () => {
      const r = await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Show as list' }));
      expect(await screen.findByRole('button', { name: 'Alpha, 1 connection' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Beta, 1 connection' }));
      expect(await screen.findByText('Note screen')).toBeTruthy();
      expect(r.getPathname()).toBe(`/note/${beta}`);
    });

    it('switches back from the list to the graph', async () => {
      useGraphStore.setState({ listView: true });
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Show graph' }));
      expect(await screen.findByRole('button', { name: 'Node Alpha' })).toBeTruthy();
    });

    it('counts several connections in the list', async () => {
      await repos.notes.save({ title: 'Gamma', bodyMd: '[[Beta]]' });
      useGraphStore.setState({ listView: true });
      await show();
      expect(await screen.findByRole('button', { name: 'Beta, 2 connections' })).toBeTruthy();
    });
  });
});
