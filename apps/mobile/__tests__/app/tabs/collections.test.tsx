import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Collections from '../../../app/(app)/(tabs)/collections/index';
import { repos } from '../../../src/data/repos';
import { freshDb, renderScreen, resetStores, stub } from '../screen-helpers/setup';

const routes = {
  collections: Collections,
  'collection/edit': stub('Edit collection'),
  'collection/[collectionId]': stub('Collection'),
};
const show = () => renderScreen(routes, '/collections');

beforeEach(async () => {
  resetStores();
  await freshDb();
});

describe('Collections tab', () => {
  it('offers to create the first collection when there is nothing to show', async () => {
    await show();
    expect(await screen.findByText('No collections yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create a collection' }));
    expect(await screen.findByText('Edit collection screen')).toBeTruthy();
  });

  it.each([0, 1])('opens the editor from new-collection button %i', async (i) => {
    await show();
    await screen.findByText('No collections yet');
    await fireEvent.press(screen.getAllByRole('button', { name: 'New collection' })[i]!);
    expect(await screen.findByText('Edit collection screen')).toBeTruthy();
  });

  describe('with a hierarchy', () => {
    let work: string;
    beforeEach(async () => {
      work = await repos.collections.save({ name: 'Work' });
      await repos.collections.save({ name: 'Projects', parentId: work });
      await repos.notes.save({ title: 'Plan', bodyMd: '', collectionId: work });
      await repos.notes.save({ title: 'Loose', bodyMd: '' });
    });

    it('shows top-level collections with note counts and the unfiled bucket', async () => {
      await show();
      expect(await screen.findByRole('button', { name: 'Unfiled, 1 notes' })).toBeTruthy();
      const row = screen.getByRole('button', { name: 'Work, 1 notes, level 1' });
      expect(row.props.accessibilityState).toMatchObject({ expanded: false });
      expect(screen.queryByText('Projects')).toBeNull();
    });

    it('expands and collapses children', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Expand Work' }));
      expect(
        await screen.findByRole('button', { name: 'Projects, 0 notes, level 2' }),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Collapse Work' }));
      await waitFor(() => expect(screen.queryByText('Projects')).toBeNull());
    });

    it('opens a collection', async () => {
      const r = await show();
      await fireEvent.press(await screen.findByRole('button', { name: /^Work, 1 notes/ }));
      expect(await screen.findByText('Collection screen')).toBeTruthy();
      expect(r.getPathname()).toBe(`/collection/${work}`);
    });

    it('opens unfiled notes', async () => {
      const r = await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Unfiled, 1 notes' }));
      expect(await screen.findByText('Collection screen')).toBeTruthy();
      expect(r.getPathname()).toBe('/collection/unfiled');
    });

    it('shows collection actions on long press', async () => {
      await show();
      await fireEvent(await screen.findByRole('button', { name: /^Work, 1 notes/ }), 'longPress');
      expect(await screen.findByRole('menuitem', { name: 'Export collection' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    });
  });

  it('shows only the unfiled bucket when notes exist without collections', async () => {
    await repos.notes.save({ title: 'Loose', bodyMd: '' });
    await show();
    expect(await screen.findByRole('button', { name: 'Unfiled, 1 notes' })).toBeTruthy();
    expect(screen.queryByText('No collections yet')).toBeNull();
  });
});
