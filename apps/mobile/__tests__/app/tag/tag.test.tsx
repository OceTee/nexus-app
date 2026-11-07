import { router, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';
import TagDetail from '../../../app/(app)/tag/[tagId]';
import TagEditor from '../../../app/(app)/tag/edit';
import Tags from '../../../app/(app)/tags/index';
import { repos } from '../../../src/data/repos';
import { TAG_COLOURS } from '../../../src/features/notes/format';
import { freshDb, toastMessage } from '../notes-helpers/setup';

jest.mock('@shopify/flash-list', () => jest.requireActual('../notes-helpers/flashList'));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () =>
  jest.requireActual('../notes-helpers/swipeable'),
);

const stub = (name: string) =>
  function Stub() {
    const params = useLocalSearchParams();
    return <Text>{`${name} ${JSON.stringify(params)}`}</Text>;
  };

const routes = {
  home: () => <Text>Home screen</Text>,
  'tags/index': Tags,
  'tag/[tagId]': TagDetail,
  'tag/edit': TagEditor,
  'note/new': stub('New note'),
  'note/[noteId]/index': stub('Editor'),
};

/** Starts on a home stub and pushes `path`, so router.back() has somewhere to go. */
async function open(path: string) {
  await renderRouter(routes, { initialUrl: '/home' });
  await act(async () => router.push(path as never));
}

beforeEach(async () => {
  await freshDb();
});
afterEach(() => jest.restoreAllMocks());

describe('Tags list', () => {
  it('offers to create the first tag', async () => {
    await open('/tags');
    expect(await screen.findByText('No tags yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create a tag' }));
    expect(await screen.findByRole('header', { name: 'New tag' })).toBeTruthy();
  });

  it('lists tags with counts and opens one', async () => {
    const work = await repos.tags.save({ name: 'work', colour: null });
    await repos.tags.save({ name: 'home' });
    const n = await repos.notes.save({ title: 'N', bodyMd: '' });
    await repos.tags.setMembership(n.id, work, true);
    await open('/tags');
    await fireEvent.press(await screen.findByRole('button', { name: 'work, 1 notes' }));
    expect(await screen.findByRole('header', { name: 'work' })).toBeTruthy();
    expect(screen.getByText('1 note')).toBeTruthy();
  });

  it('opens the editor from the header', async () => {
    await repos.tags.save({ name: 'work' });
    await open('/tags');
    await fireEvent.press(await screen.findByRole('button', { name: 'New tag' }));
    expect(await screen.findByRole('header', { name: 'New tag' })).toBeTruthy();
  });
});

describe('Tag detail', () => {
  it('lists the tagged notes and creates a tagged note', async () => {
    const tag = await repos.tags.save({ name: 'work' });
    const a = await repos.notes.save({ title: 'Tagged', bodyMd: '' });
    await repos.notes.save({ title: 'Other', bodyMd: '' });
    await repos.tags.setMembership(a.id, tag, true);
    await open(`/tag/${tag}`);
    expect(await screen.findByText('Tagged')).toBeTruthy();
    expect(screen.queryByText('Other')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'New note with this tag' }));
    expect(await screen.findByText(`New note {"tagId":"${tag}"}`)).toBeTruthy();
  });

  it('shows an empty tag with a count of zero', async () => {
    const tag = await repos.tags.save({ name: 'empty' });
    await open(`/tag/${tag}`);
    expect(await screen.findByText('No notes carry this tag')).toBeTruthy();
    expect(screen.getByText('0 notes')).toBeTruthy();
  });

  it('explains a deleted tag', async () => {
    await open('/tag/gone');
    expect(await screen.findByText('This tag was deleted')).toBeTruthy();
  });

  it.each([
    ['Rename', 'Edit tag'],
    ['Recolour', 'Recolour tag'],
    ['Merge into…', 'Merge “work” into…'],
  ])('%s opens the editor', async (item, header) => {
    const tag = await repos.tags.save({ name: 'work' });
    await open(`/tag/${tag}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: item }));
    expect(await screen.findByRole('header', { name: header })).toBeTruthy();
  });

  it('deletes the tag after confirming', async () => {
    const tag = await repos.tags.save({ name: 'work' });
    await open(`/tag/${tag}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText('Delete “work”?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete tag' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(await repos.tags.get(tag)).toBeNull();
    expect(toastMessage()).toBe('Tag deleted');
  });
});

describe('Tag editor', () => {
  it('creates a tag with a chosen colour', async () => {
    await open('/tag/edit');
    const first = await screen.findByRole('radio', { name: 'Colour 1' });
    await waitFor(() => expect(first.props.accessibilityState.checked).toBe(true));
    await fireEvent.press(screen.getByRole('radio', { name: 'Colour 3' }));
    await fireEvent.changeText(screen.getByLabelText('Name'), ' ideas ');
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    const [tag] = await repos.tags.list();
    expect(tag).toMatchObject({ name: 'ideas', colour: TAG_COLOURS[2] });
    expect(toastMessage()).toBe('Created “ideas”');
  });

  it('picks the next colour for a new tag', async () => {
    await repos.tags.save({ name: 'a', colour: TAG_COLOURS[0] });
    await open('/tag/edit');
    const second = await screen.findByRole('radio', { name: 'Colour 2' });
    await waitFor(() => expect(second.props.accessibilityState.checked).toBe(true));
  });

  it('validates the name and reports duplicates', async () => {
    await repos.tags.save({ name: 'taken' });
    await open('/tag/edit');
    await fireEvent.press(await screen.findByRole('button', { name: 'Create' }));
    expect(screen.getByText('Enter a name')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'taken');
    expect(screen.queryByText('Enter a name')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/already exists/)).toBeTruthy();
    jest.spyOn(repos.tags, 'save').mockRejectedValueOnce(new Error('disk'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'fresh');
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Could not save the tag')).toBeTruthy();
  });

  it('renames and recolours an existing tag', async () => {
    const tag = await repos.tags.save({ name: 'work', colour: TAG_COLOURS[1] });
    await open(`/tag/edit?id=${tag}&mode=colour`);
    expect(await screen.findByRole('header', { name: 'Recolour tag' })).toBeTruthy();
    expect(await screen.findByDisplayValue('work')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Colour 2' }).props.accessibilityState.checked).toBe(
      true,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Colour 4' }));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'job');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(await repos.tags.get(tag)).toMatchObject({ name: 'job', colour: TAG_COLOURS[3] });
    expect(toastMessage()).toBe('Tag saved');
  });

  it('keeps the default colour for a tag without one', async () => {
    const tag = await repos.tags.save({ name: 'plain', colour: null });
    await open(`/tag/edit?id=${tag}`);
    expect(await screen.findByRole('header', { name: 'Edit tag' })).toBeTruthy();
    const first = await screen.findByRole('radio', { name: 'Colour 1' });
    await waitFor(() => expect(first.props.accessibilityState.checked).toBe(true));
  });

  it('merges one tag into another', async () => {
    const from = await repos.tags.save({ name: 'wrk' });
    await repos.tags.save({ name: 'work', colour: null });
    const n = await repos.notes.save({ title: 'N', bodyMd: '' });
    await repos.tags.setMembership(n.id, from, true);
    await open(`/tag/edit?id=${from}&mode=merge`);
    expect(await screen.findByRole('header', { name: 'Merge “wrk” into…' })).toBeTruthy();
    await fireEvent.press(screen.getByText('work'));
    expect(screen.getByText('Merge into “work”?')).toBeTruthy();
    // The header's back button is also called Cancel; the sheet's comes last.
    await fireEvent.press(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);
    await fireEvent.press(screen.getByText('work'));
    await fireEvent.press(screen.getByRole('button', { name: 'Merge tags' }));
    expect(await screen.findByRole('header', { name: 'work' })).toBeTruthy();
    expect(await repos.tags.get(from)).toBeNull();
    expect((await repos.tags.forNote(n.id)).map((t) => t.name)).toEqual(['work']);
    expect(toastMessage()).toBe('Merged into “work”');
  });

  it('says when there is nothing to merge into', async () => {
    const only = await repos.tags.save({ name: 'only' });
    await open(`/tag/edit?id=${only}&mode=merge`);
    expect(await screen.findByText('There are no other tags to merge into.')).toBeTruthy();
  });
});
