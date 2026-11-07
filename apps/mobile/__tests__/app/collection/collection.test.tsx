import { router, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';
import CollectionDetail from '../../../app/(app)/collection/[collectionId]';
import CollectionEditor from '../../../app/(app)/collection/edit';
import CollectionPicker from '../../../app/(app)/collection/picker';
import { CollectionPlacementError, repos } from '../../../src/data/repos';
import { freshDb, toastMessage } from '../notes-helpers/setup';

jest.mock('@shopify/flash-list', () => jest.requireActual('../notes-helpers/flashList'));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () =>
  jest.requireActual('../notes-helpers/swipeable'),
);

/** Shows a route's params, standing in for screens outside this suite. */
const stub = (name: string) =>
  function Stub() {
    const params = useLocalSearchParams();
    return <Text>{`${name} ${JSON.stringify(params)}`}</Text>;
  };

const routes = {
  home: () => <Text>Home screen</Text>,
  'collection/[collectionId]': CollectionDetail,
  'collection/edit': CollectionEditor,
  'collection/picker': CollectionPicker,
  'note/new': stub('New note'),
  'note/[noteId]/index': stub('Editor'),
};

/** Starts on a home stub and pushes `path`, so Back and router.back() have somewhere to go. */
async function open(path: string) {
  await renderRouter(routes, { initialUrl: '/home' });
  await act(async () => router.push(path as never));
}

beforeEach(async () => {
  await freshDb();
});
afterEach(() => jest.restoreAllMocks());

describe('Collection detail', () => {
  it('shows the path, sub-collections and notes', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    const proj = await repos.collections.save({ name: 'Projects', parentId: work });
    const alpha = await repos.collections.save({ name: 'Alpha', parentId: proj });
    await repos.notes.save({ title: 'Kickoff', bodyMd: 'x', collectionId: alpha });
    await repos.notes.save({ title: 'Roadmap', bodyMd: 'y', collectionId: proj });
    await open(`/collection/${proj}`);
    expect(await screen.findByRole('header', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
    expect(await screen.findByText('Roadmap')).toBeTruthy();
    expect(screen.queryByText('Kickoff')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Tag Alpha · 1' }));
    expect(await screen.findByRole('header', { name: 'Alpha' })).toBeTruthy();
    expect(await screen.findByText('Kickoff')).toBeTruthy();
  });

  it('shows an empty collection and creates a note in it', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    await open(`/collection/${work}`);
    expect(await screen.findByText('No notes in this collection')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'New note here' }));
    expect(await screen.findByText(`New note {"collectionId":"${work}"}`)).toBeTruthy();
  });

  it('lists unfiled notes and creates an unfiled note', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    await repos.notes.save({ title: 'Loose', bodyMd: 'x' });
    await repos.notes.save({ title: 'Filed', bodyMd: 'x', collectionId: work });
    await open('/collection/unfiled');
    expect(await screen.findByRole('header', { name: 'Unfiled' })).toBeTruthy();
    expect(await screen.findByText('Loose')).toBeTruthy();
    expect(screen.queryByText('Filed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'New note here' }));
    expect(await screen.findByText('New note {}')).toBeTruthy();
  });

  it('explains a deleted collection', async () => {
    await open('/collection/gone');
    expect(await screen.findByText('This collection was deleted')).toBeTruthy();
  });

  it('renames from the menu', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    await open(`/collection/${work}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(await screen.findByRole('header', { name: 'Rename collection' })).toBeTruthy();
  });

  it('deletes an empty collection from the menu and goes back', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    await open(`/collection/${work}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(await repos.collections.get(work)).toBeNull();
    expect(toastMessage()).toBe('Deleted “Work”');
  });
});

describe('Collection editor', () => {
  it('creates a top-level collection', async () => {
    await open('/collection/edit');
    expect(await screen.findByRole('header', { name: 'New collection' })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Reading  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    const [c] = await repos.collections.list();
    expect(c).toMatchObject({ name: 'Reading', parentId: null });
    expect(toastMessage()).toBe('Created “Reading”');
  });

  it('creates inside a parent by submitting the field', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    await open(`/collection/edit?parentId=${work}`);
    const field = await screen.findByLabelText('Name');
    await fireEvent.changeText(field, 'Projects');
    await fireEvent(field, 'submitEditing');
    expect(await screen.findByText('Home screen')).toBeTruthy();
    const child = (await repos.collections.list()).find((c) => c.name === 'Projects');
    expect(child?.parentId).toBe(work);
  });

  it('renames an existing collection', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    await open(`/collection/edit?id=${work}`);
    expect(await screen.findByDisplayValue('Work')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Job');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect((await repos.collections.get(work))?.name).toBe('Job');
    expect(toastMessage()).toBe('Collection renamed');
  });

  it('validates the name', async () => {
    await open('/collection/edit');
    await fireEvent.press(await screen.findByRole('button', { name: 'Create' }));
    expect(screen.getByText('Enter a name')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'x'.repeat(81));
    expect(screen.queryByText('Enter a name')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Use 80 characters or fewer')).toBeTruthy();
    expect(await repos.collections.list()).toEqual([]);
  });

  it('shows placement and unexpected errors', async () => {
    await open('/collection/edit');
    const save = jest
      .spyOn(repos.collections, 'save')
      .mockRejectedValueOnce(new CollectionPlacementError('DEPTH_EXCEEDED'));
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Deep');
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Collections nest at most 6 deep')).toBeTruthy();
    save.mockRejectedValueOnce(new Error('disk'));
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Could not save the collection')).toBeTruthy();
  });
});

describe('Collection picker', () => {
  it('moves an unfiled note into a collection', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    await repos.collections.save({ name: 'Projects', parentId: work });
    const n = await repos.notes.save({ title: 'N', bodyMd: '' });
    await open(`/collection/picker?noteId=${n.id}`);
    const unfiled = await screen.findByRole('button', { name: 'Unfiled' });
    await waitFor(() => expect(unfiled.props.accessibilityState.selected).toBe(true));
    await fireEvent.press(screen.getByRole('button', { name: 'Projects' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(toastMessage()).toBe('Moved to “Projects”');
    const projects = (await repos.collections.list()).find((c) => c.name === 'Projects')!;
    expect((await repos.notes.get(n.id))?.collectionId).toBe(projects.id);
  });

  it('moves a filed note back to Unfiled', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    await repos.collections.save({ name: 'Projects', parentId: work });
    const projects = (await repos.collections.list()).find((c) => c.name === 'Projects')!;
    const n = await repos.notes.save({ title: 'N', bodyMd: '', collectionId: projects.id });
    await open(`/collection/picker?noteId=${n.id}`);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Projects' }).props.accessibilityState.selected,
      ).toBe(true),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Unfiled' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(toastMessage()).toBe('Moved to Unfiled');
    expect((await repos.notes.get(n.id))?.collectionId).toBeNull();
  });

  it('moves a collection, blocking itself and its descendants', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    const proj = await repos.collections.save({ name: 'Projects', parentId: work });
    await repos.collections.save({ name: 'Alpha', parentId: proj });
    const home = await repos.collections.save({ name: 'Home' });
    await open(`/collection/picker?collectionId=${proj}`);
    expect(await screen.findByRole('button', { name: 'Top level' })).toBeTruthy();
    const self = await screen.findByRole('button', { name: 'Projects, not available' });
    expect(self.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Alpha, not available' })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Work' }).props.accessibilityState.selected).toBe(
        true,
      ),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Home' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect((await repos.collections.get(proj))?.parentId).toBe(home);
    expect(toastMessage()).toBe('Moved to “Home”');
  });

  it('moves a collection to the top level', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    const proj = await repos.collections.save({ name: 'Projects', parentId: work });
    await open(`/collection/picker?collectionId=${proj}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'Top level' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect((await repos.collections.get(proj))?.parentId).toBeNull();
    expect(toastMessage()).toBe('Moved to the top level');
  });

  it('blocks destinations that would make the tree too deep', async () => {
    // A chain five deep, and a collection with one child (height 2): only L5 would put
    // Inner at depth 7.
    let parent: string | null = null;
    for (let i = 1; i <= 5; i += 1) {
      parent = await repos.collections.save({ name: `L${i}`, parentId: parent });
    }
    const box = await repos.collections.save({ name: 'Box' });
    await repos.collections.save({ name: 'Inner', parentId: box });
    await open(`/collection/picker?collectionId=${box}`);
    expect(await screen.findByRole('button', { name: 'L5, not available' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'L4' })).toBeTruthy();
  });

  it('reports a failed move and stays', async () => {
    await repos.collections.save({ name: 'Work' });
    const n = await repos.notes.save({ title: 'N', bodyMd: '' });
    await open(`/collection/picker?noteId=${n.id}`);
    const move = jest
      .spyOn(repos.notes, 'move')
      .mockRejectedValueOnce(new CollectionPlacementError('CYCLE'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Work' }));
    await waitFor(() => expect(toastMessage()).toBe('A collection cannot go inside itself'));
    move.mockRejectedValueOnce(new Error('disk'));
    await fireEvent.press(screen.getByRole('button', { name: 'Work' }));
    await waitFor(() => expect(toastMessage()).toBe('Could not move it'));
    expect(screen.getByRole('header', { name: 'Move to' })).toBeTruthy();
    expect((await repos.notes.get(n.id))?.collectionId).toBeNull();
  });

  it('does nothing but close without a note or collection', async () => {
    await repos.collections.save({ name: 'Work' });
    await open('/collection/picker');
    await fireEvent.press(await screen.findByRole('button', { name: 'Work' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
  });
});
