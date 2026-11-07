import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import GraphFilters from '../../../app/(app)/graph/filters';
import { repos } from '../../../src/data/repos';
import { DEFAULT_FILTERS, useGraphStore } from '../../../src/features/graph/store';
import { freshDb } from '../notes-helpers/setup';

const open = () =>
  renderRouter({ 'graph/filters': GraphFilters }, { initialUrl: '/graph/filters' });
const filters = () => useGraphStore.getState().filters;

beforeEach(async () => {
  await freshDb();
  useGraphStore.setState({ filters: DEFAULT_FILTERS });
});

describe('Graph filters', () => {
  it('shows defaults with no tags or collections', async () => {
    await open();
    expect(await screen.findByRole('header', { name: 'Graph filters' })).toBeTruthy();
    expect(await screen.findByText('No tags yet.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show notes without links' }).props.value).toBe(true);
    expect(screen.getByRole('switch', { name: 'Connect notes that share a tag' }).props.value).toBe(
      false,
    );
    expect(
      screen.getByRole('radio', { name: 'All collections' }).props.accessibilityState.checked,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('toggles the switches', async () => {
    await open();
    await fireEvent(
      await screen.findByRole('switch', { name: 'Show notes without links' }),
      'valueChange',
      false,
    );
    await fireEvent(
      screen.getByRole('switch', { name: 'Connect notes that share a tag' }),
      'valueChange',
      true,
    );
    expect(filters()).toMatchObject({ showOrphans: false, tagEdges: true });
  });

  it('selects tags and a collection, then resets', async () => {
    const work = await repos.tags.save({ name: 'work' });
    const home = await repos.tags.save({ name: 'home' });
    const top = await repos.collections.save({ name: 'Work' });
    const sub = await repos.collections.save({ name: 'Projects', parentId: top });
    await open();

    await fireEvent.press(await screen.findByRole('button', { name: 'Tag work' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tag home' }));
    expect(filters().tagIds).toEqual([work, home]);
    expect(screen.getByRole('button', { name: 'Tag work' }).props.accessibilityState.selected).toBe(
      true,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Tag work' }));
    expect(filters().tagIds).toEqual([home]);

    await fireEvent.press(await screen.findByRole('radio', { name: 'Work › Projects' }));
    expect(filters().collectionId).toBe(sub);
    expect(
      screen.getByRole('radio', { name: 'Work › Projects' }).props.accessibilityState.checked,
    ).toBe(true);

    await fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(filters()).toEqual(DEFAULT_FILTERS));
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });
});
