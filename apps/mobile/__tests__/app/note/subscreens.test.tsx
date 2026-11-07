import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';
import Backlinks from '../../../app/(app)/note/[noteId]/backlinks';
import NoteInfo from '../../../app/(app)/note/[noteId]/info';
import NoteTags from '../../../app/(app)/note/[noteId]/tags';
import NewNote from '../../../app/(app)/note/new';
import { DuplicateTagError, repos } from '../../../src/data/repos';
import { useLocalSearchParams } from 'expo-router';
import type { SqlDb } from '../../../src/infra/sql';
import { freshDb, toastMessage } from '../notes-helpers/setup';

/** Stands in for the editor: shows which note and params it was opened with. */
function EditorStub() {
  const { noteId, fresh } = useLocalSearchParams<{ noteId: string; fresh?: string }>();
  return <Text>{`Editor ${noteId}${fresh ? ' fresh' : ''}`}</Text>;
}

let db: SqlDb;

beforeEach(async () => {
  db = await freshDb();
});
afterEach(() => jest.restoreAllMocks());

describe('New note', () => {
  const routes = { 'note/new': NewNote, 'note/[noteId]/index': EditorStub };

  it('creates an empty draft and opens it fresh', async () => {
    await renderRouter(routes, { initialUrl: '/note/new' });
    const [note] = await waitFor(async () => {
      const all = await repos.notes.list({});
      expect(all).toHaveLength(1);
      return all;
    });
    expect(await screen.findByText(`Editor ${note!.id} fresh`)).toBeTruthy();
    expect(note).toMatchObject({ title: '', bodyMd: '', collectionId: null });
  });

  it('files the draft in a collection, tags it and titles it', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    const tag = await repos.tags.save({ name: 'todo' });
    await renderRouter(routes, {
      initialUrl: `/note/new?collectionId=${work}&tagId=${tag}&title=Plan`,
    });
    expect(await screen.findByText(/^Editor .* fresh$/)).toBeTruthy();
    const [note] = await repos.notes.list({});
    expect(note).toMatchObject({ title: 'Plan', collectionId: work });
    expect((await repos.tags.forNote(note!.id)).map((t) => t.name)).toEqual(['todo']);
  });
});

describe('Backlinks', () => {
  const routes = { 'note/[noteId]/backlinks': Backlinks, 'note/[noteId]/index': EditorStub };
  const open = (id: string) => renderRouter(routes, { initialUrl: `/note/${id}/backlinks` });

  it('lists notes linking here with the title highlighted, and opens them', async () => {
    const target = await repos.notes.save({ title: 'Target', bodyMd: '' });
    const src = await repos.notes.save({ title: 'Source', bodyMd: 'Read [[Target]] today.' });
    await open(target.id);
    expect(await screen.findByRole('header', { name: 'Backlinks' })).toBeTruthy();
    expect(await screen.findByText('Source')).toBeTruthy();
    expect(screen.getByText('Target')).toBeTruthy();
    await fireEvent.press(screen.getByText('Source'));
    expect(await screen.findByText(`Editor ${src.id}`)).toBeTruthy();
  });

  it('shows plain context when the title does not appear in it', async () => {
    const target = await repos.notes.save({ title: 'Big  Idea', bodyMd: '' });
    await repos.notes.save({ title: '', bodyMd: 'About [[big idea]].' });
    await open(target.id);
    expect(await screen.findByText('Untitled')).toBeTruthy();
    expect(screen.getByText(/About \[\[big idea\]\]/)).toBeTruthy();
  });

  it('lists unlinked mentions and links one', async () => {
    const target = await repos.notes.save({ title: 'Target', bodyMd: '' });
    const m = await repos.notes.save({ title: 'Mentions', bodyMd: 'The target is near.' });
    await open(target.id);
    expect(await screen.findByText('UNLINKED MENTIONS')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Link the mention in Mentions' }));
    await waitFor(async () =>
      expect((await repos.notes.get(m.id))?.bodyMd).toBe('The [[target]] is near.'),
    );
    expect(toastMessage()).toBe('Linked from “Mentions”');
    // Now a real backlink, so the mention section goes away.
    await waitFor(() => expect(screen.queryByText('UNLINKED MENTIONS')).toBeNull());
  });

  it('opens a mentioning note, and says nothing when linking fails', async () => {
    const target = await repos.notes.save({ title: 'Target', bodyMd: '' });
    const m = await repos.notes.save({ title: '', bodyMd: 'A target here.' });
    await open(target.id);
    jest.spyOn(repos.notes, 'linkMention').mockResolvedValueOnce(false);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Link the mention in Untitled' }),
    );
    expect(toastMessage()).toBeNull();
    await fireEvent.press(screen.getByText('Untitled'));
    expect(await screen.findByText(`Editor ${m.id}`)).toBeTruthy();
  });

  it('shows an empty state with no backlinks, also for an untitled note', async () => {
    const n = await repos.notes.save({ title: '', bodyMd: '' });
    await open(n.id);
    expect(await screen.findByText('No backlinks')).toBeTruthy();
  });
});

describe('Note info', () => {
  const open = (id: string) =>
    renderRouter({ 'note/[noteId]/info': NoteInfo }, { initialUrl: `/note/${id}/info` });

  it('shows metadata for a local note', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    const proj = await repos.collections.save({ name: 'Projects', parentId: work });
    await repos.notes.save({ title: 'Other', bodyMd: '' });
    const n = await repos.notes.save({
      title: 'Plan',
      bodyMd: 'one two three [[Other]]',
      collectionId: proj,
    });
    await open(n.id);
    expect(await screen.findByText('Plan')).toBeTruthy();
    expect(await screen.findByText('Work › Projects')).toBeTruthy();
    expect(screen.getByText('Words')).toBeTruthy();
    expect(screen.getByText('1 min')).toBeTruthy();
    expect(screen.getByText('Not on the server yet')).toBeTruthy();
    expect(screen.getByText('1 change waiting')).toBeTruthy();
    expect(screen.getByText('Links out')).toBeTruthy();
  });

  it('shows an unfiled, synced note', async () => {
    const n = await repos.notes.save({ title: '', bodyMd: 'x' });
    await db.runAsync(`UPDATE notes SET server_rev = 4, dirty = 0 WHERE id = ?`, [n.id]);
    await db.runAsync(`DELETE FROM outbox`);
    await open(n.id);
    expect(await screen.findByText('4 on the server')).toBeTruthy();
    expect(screen.getByText('Untitled')).toBeTruthy();
    expect(screen.getByText('Unfiled')).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
  });

  it('says Waiting for a dirty note with nothing queued', async () => {
    const n = await repos.notes.save({ title: 'A', bodyMd: 'x' });
    await db.runAsync(`DELETE FROM outbox`);
    await open(n.id);
    expect(await screen.findByText('Waiting')).toBeTruthy();
  });

  it('counts several queued changes', async () => {
    const n = await repos.notes.save({ title: 'A', bodyMd: 'x' });
    await repos.notes.save({ id: n.id, title: 'A', bodyMd: 'y' });
    const t = await repos.tags.save({ name: 'x' });
    await repos.tags.setMembership(n.id, t, true);
    await open(n.id);
    expect(await screen.findByText(/changes waiting/)).toBeTruthy();
  });

  it('renders only the title placeholder for an unknown note', async () => {
    await open('nope');
    expect(await screen.findByText('Untitled')).toBeTruthy();
    expect(screen.queryByText('Words')).toBeNull();
  });
});

describe('Note tags', () => {
  let noteId: string;
  const open = () =>
    renderRouter({ 'note/[noteId]/tags': NoteTags }, { initialUrl: `/note/${noteId}/tags` });
  const names = async () => (await repos.tags.forNote(noteId)).map((t) => t.name).sort();

  beforeEach(async () => {
    noteId = (await repos.notes.save({ title: 'N', bodyMd: '' })).id;
  });

  it('toggles existing tags', async () => {
    await repos.tags.save({ name: 'work' });
    await repos.tags.save({ name: 'home' });
    await open();
    const work = await screen.findByRole('checkbox', { name: 'work' });
    expect(work.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(work);
    await waitFor(async () => expect(await names()).toEqual(['work']));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'work' }).props.accessibilityState.checked).toBe(
        true,
      ),
    );
    await fireEvent.press(screen.getByRole('checkbox', { name: 'work' }));
    await waitFor(async () => expect(await names()).toEqual([]));
  });

  it('filters by the query and creates a new tag', async () => {
    await repos.tags.save({ name: 'work' });
    await open();
    await screen.findByRole('checkbox', { name: 'work' });
    await fireEvent.changeText(screen.getByLabelText('Find or create a tag'), 'ideas');
    expect(screen.queryByRole('checkbox', { name: 'work' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Create “ideas”' }));
    await waitFor(async () => expect(await names()).toEqual(['ideas']));
    expect(screen.getByLabelText('Find or create a tag').props.value).toBe('');
  });

  it('creates on submit, but not for an exact match or an invalid name', async () => {
    await repos.tags.save({ name: 'work' });
    await open();
    const field = await screen.findByLabelText('Find or create a tag');
    await fireEvent.changeText(field, 'WORK');
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
    await fireEvent(field, 'submitEditing');
    await fireEvent.changeText(field, 'two words');
    expect(screen.getByText('Tags are one word: use - or _ instead of spaces')).toBeTruthy();
    await fireEvent(field, 'submitEditing');
    await fireEvent.changeText(field, 'fresh');
    await fireEvent(field, 'submitEditing');
    await waitFor(async () => expect(await names()).toEqual(['fresh']));
    expect((await repos.tags.list()).map((t) => t.name).sort()).toEqual(['fresh', 'work']);
  });

  it('reports a duplicate or failed create', async () => {
    await open();
    const field = await screen.findByLabelText('Find or create a tag');
    jest.spyOn(repos.tags, 'save').mockRejectedValueOnce(new DuplicateTagError('dup'));
    await fireEvent.changeText(field, 'dup');
    await fireEvent.press(screen.getByRole('button', { name: 'Create “dup”' }));
    await waitFor(() => expect(toastMessage()).toBe('A tag named "dup" already exists'));
    jest.spyOn(repos.tags, 'save').mockRejectedValueOnce(new Error('disk'));
    await fireEvent.press(screen.getByRole('button', { name: 'Create “dup”' }));
    await waitFor(() => expect(toastMessage()).toBe('Could not create the tag'));
  });

  it('stops at the per-note tag limit', async () => {
    for (let i = 0; i < 50; i += 1) {
      const id = await repos.tags.save({ name: `t${i}` });
      await repos.tags.setMembership(noteId, id, true);
    }
    await repos.tags.save({ name: 'extra' });
    await open();
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'extra' }));
    await waitFor(() => expect(toastMessage()).toBe('A note can have up to 50 tags'));
    expect(await names()).not.toContain('extra');
  });
});
