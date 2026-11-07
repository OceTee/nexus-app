import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AppState, Text } from 'react-native';
import NoteScreen from '../../../app/(app)/note/[noteId]/index';
import { repos } from '../../../src/data/repos';
import { runSync } from '../../../src/data/sync';
import type { SqlDb } from '../../../src/infra/sql';
import { useSessionStore } from '../../../src/stores/session';
import { freshDb, toastMessage } from '../notes-helpers/setup';

// marked ships an ES module build Jest does not transform; use its UMD build.
jest.mock('marked', () =>
  jest.requireActual('../../../../../node_modules/marked/lib/marked.umd.js'),
);
// The editor syncs once for a deep link to an unknown note; no network in tests.
jest.mock('../../../src/data/sync', () => ({
  ...jest.requireActual('../../../src/data/sync'),
  runSync: jest.fn().mockResolvedValue(undefined),
}));

const stub = (label: string) =>
  function Stub() {
    return <Text>{label}</Text>;
  };

const routes = {
  'note/[noteId]/index': NoteScreen,
  'note/[noteId]/backlinks': stub('Backlinks screen'),
  'note/[noteId]/conflict': stub('Conflict screen'),
  'note/[noteId]/tags': stub('Tags screen'),
  'note/[noteId]/info': stub('Info screen'),
  'note/[noteId]/versions/index': stub('Versions screen'),
  'collection/picker': stub('Picker screen'),
  'tag/[tagId]': stub('Tag screen'),
  'attachment/pick': stub('Attach screen'),
  notes: stub('Notes screen'),
};

let db: SqlDb;

const open = (id: string, query = '') =>
  renderRouter(routes, { initialUrl: `/note/${id}${query}` });

const stored = (id: string) => repos.notes.get(id);

beforeEach(async () => {
  jest.clearAllMocks();
  db = await freshDb();
  useSessionStore.setState({ status: 'local' });
});
afterEach(() => jest.restoreAllMocks());

describe('Note editor: loading', () => {
  it('opens a written note in Read mode', async () => {
    const n = await repos.notes.save({ title: 'Hello', bodyMd: 'World body' });
    await open(n.id);
    expect(await screen.findByDisplayValue('Hello')).toBeTruthy();
    expect(await screen.findByText('World body')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Read' }).props.accessibilityState.selected).toBe(true);
    expect(screen.queryByLabelText('Note body')).toBeNull();
  });

  it('opens an empty note in Edit mode', async () => {
    const empty = await repos.notes.save({ title: 'Empty', bodyMd: '' });
    await open(empty.id);
    expect(await screen.findByLabelText('Note body')).toBeTruthy();
  });

  it('opens a fresh note in Edit mode even with text', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'text' });
    await open(n.id, '?fresh=1');
    expect(await screen.findByDisplayValue('text')).toBeTruthy();
  });

  it('switches between Edit, Preview and Read', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: '# Heading' });
    await open(n.id);
    expect(await screen.findByRole('header', { name: 'Heading' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Edit' }));
    expect(await screen.findByDisplayValue('# Heading')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Preview' }));
    expect(await screen.findByRole('header', { name: 'Heading' })).toBeTruthy();
  });

  it('explains a note that does not exist', async () => {
    await open('missing');
    expect(await screen.findByText('This note was deleted')).toBeTruthy();
    expect(screen.getByText('It may have been deleted on another device.')).toBeTruthy();
    expect(runSync).not.toHaveBeenCalled();
  });

  it('syncs once before giving up on an unknown note when signed in', async () => {
    useSessionStore.setState({ status: 'authed' });
    await open('missing');
    expect(await screen.findByText('This note was deleted')).toBeTruthy();
    expect(runSync).toHaveBeenCalledWith('manual');
  });

  it('offers to restore a trashed note', async () => {
    const n = await repos.notes.save({ title: 'Gone', bodyMd: 'x' });
    await repos.notes.trashNote(n.id);
    await open(n.id);
    await fireEvent.press(await screen.findByRole('button', { name: 'Restore from trash' }));
    await waitFor(async () => expect((await stored(n.id))?.deletedAt).toBeNull());
    expect(await screen.findByDisplayValue('Gone')).toBeTruthy();
  });
});

describe('Note editor: autosave', () => {
  it('saves title and body edits after a pause', async () => {
    const n = await repos.notes.save({ title: 'Old', bodyMd: '' });
    await open(n.id);
    await fireEvent.changeText(await screen.findByLabelText('Title'), 'New title');
    expect(screen.getByText('Saving…')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Note body'), 'Some words');
    await waitFor(async () => {
      const s = await stored(n.id);
      expect(s?.title).toBe('New title');
      expect(s?.bodyMd).toBe('Some words');
    });
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
  });

  it('saves when the app goes to the background', async () => {
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, l) => {
      listeners.push(l as (s: string) => void);
      return { remove: jest.fn() } as never;
    });
    const n = await repos.notes.save({ title: 'Old', bodyMd: '' });
    await open(n.id);
    await fireEvent.changeText(await screen.findByLabelText('Title'), 'Backgrounded');
    await act(async () => listeners.forEach((l) => l('background')));
    expect((await stored(n.id))?.title).toBe('Backgrounded');
  });

  it('shows a failed save with Retry, and retries', async () => {
    const n = await repos.notes.save({ title: 'Old', bodyMd: '' });
    await open(n.id);
    const real = repos.notes.save.bind(repos.notes);
    const save = jest.spyOn(repos.notes, 'save').mockRejectedValueOnce(new Error('disk full'));
    await fireEvent.changeText(await screen.findByLabelText('Title'), 'Failing');
    expect(await screen.findByText('Not saved', {}, { timeout: 2000 })).toBeTruthy();
    expect(
      screen.getByText(
        'Your changes could not be saved. Free some space on this device, then try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Title').props.editable).toBe(false);
    save.mockImplementation(real);
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(async () => expect((await stored(n.id))?.title).toBe('Failing'));
    await waitFor(() => expect(screen.queryByText('Not saved')).toBeNull());
  });

  it('refuses a body over the size limit', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: '' });
    await open(n.id);
    await fireEvent.changeText(await screen.findByLabelText('Note body'), 'x'.repeat(200_001));
    expect(toastMessage()).toBe('Notes can hold up to 200,000 characters');
    expect(screen.getByLabelText('Note body').props.value).toBe('');
  });

  it('counts long titles and warns about duplicate titles', async () => {
    await repos.notes.save({ title: 'Taken', bodyMd: '' });
    const n = await repos.notes.save({ title: 'Mine', bodyMd: '' });
    await open(n.id);
    await fireEvent.changeText(await screen.findByLabelText('Title'), 'Taken');
    expect(
      await screen.findByText('Another note has this title, so [[links]] go to the older one.'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'a'.repeat(185));
    expect(await screen.findByText('185/200')).toBeTruthy();
  });

  it('shows edits that arrive from elsewhere while idle', async () => {
    const n = await repos.notes.save({ title: 'Before', bodyMd: '' });
    await open(n.id);
    expect(await screen.findByDisplayValue('Before')).toBeTruthy();
    await act(async () => {
      await repos.notes.save({ id: n.id, title: 'After', bodyMd: 'synced text' });
    });
    expect(await screen.findByDisplayValue('After')).toBeTruthy();
    expect(screen.getByDisplayValue('synced text')).toBeTruthy();
  });
});

describe('Note editor: toolbar', () => {
  it('applies formatting and undoes it', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: '' });
    await open(n.id);
    const body = await screen.findByLabelText('Note body');
    await fireEvent.changeText(body, 'word');
    await fireEvent(body, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 4 } } });
    await fireEvent.press(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByLabelText('Note body').props.value).toBe('**word**');
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Note body').props.value).toBe('word');
    await fireEvent.press(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByLabelText('Note body').props.value).toBe('**word**');

    for (const name of ['Italic', 'Heading', 'Bulleted list', 'Task', 'Code']) {
      await fireEvent.press(screen.getByRole('button', { name }));
    }
    expect(screen.getByLabelText('Note body').props.value).not.toBe('**word**');
    await waitFor(async () =>
      expect((await stored(n.id))?.bodyMd).toBe(screen.getByLabelText('Note body').props.value),
    );
  });

  it('inserts a wiki link and completes it from suggestions', async () => {
    const target = await repos.notes.save({ title: 'Beta note', bodyMd: '' });
    const n = await repos.notes.save({ title: 'T', bodyMd: '' });
    await open(n.id);
    await screen.findByLabelText('Note body');
    await fireEvent.press(screen.getByRole('button', { name: 'Link to a note' }));
    expect(screen.getByLabelText('Note body').props.value).toBe('[[]]');
    expect(await screen.findByText('Type a note title to link it')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Note body'), '[[Be]]');
    await fireEvent.press(await screen.findByRole('button', { name: `Link ${target.title}` }));
    expect(screen.getByLabelText('Note body').props.value).toContain('[[Beta note]]');
  });

  it('saves before opening the attachment picker', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: '' });
    await open(n.id);
    await fireEvent.changeText(await screen.findByLabelText('Note body'), 'unsaved');
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a file' }));
    expect(await screen.findByText('Attach screen')).toBeTruthy();
    expect(screen).toHavePathname('/attachment/pick');
    expect((await stored(n.id))?.bodyMd).toBe('unsaved');
  });
});

describe('Note editor: links, tags and conflicts', () => {
  it('opens backlinks from the footer', async () => {
    const n = await repos.notes.save({ title: 'Target', bodyMd: 'body' });
    await repos.notes.save({ title: 'Source', bodyMd: 'see [[Target]]' });
    await open(n.id);
    await fireEvent.press(await screen.findByText(/1 note links here/));
    expect(await screen.findByText('Backlinks screen')).toBeTruthy();
  });

  it('counts several backlinks', async () => {
    const n = await repos.notes.save({ title: 'Target', bodyMd: '' });
    await repos.notes.save({ title: 'A', bodyMd: '[[Target]]' });
    await repos.notes.save({ title: 'B', bodyMd: '[[Target]]' });
    await open(n.id);
    expect(await screen.findByText(/2 notes link here/)).toBeTruthy();
  });

  it('follows a wiki link to an existing note, ignoring self links', async () => {
    const other = await repos.notes.save({ title: 'Other', bodyMd: 'other body' });
    const n = await repos.notes.save({ title: 'Self', bodyMd: '[[Self]] and [[Other]]' });
    await open(n.id);
    await fireEvent.press(await screen.findByText('Self', { exact: true }));
    await fireEvent.press(await screen.findByText('Other'));
    expect(await screen.findByText('other body')).toBeTruthy();
    expect(screen).toHaveSearchParams({ noteId: other.id, depth: '1' });
  });

  it('replaces instead of pushing at the maximum stack depth', async () => {
    const other = await repos.notes.save({ title: 'Other', bodyMd: 'other body' });
    const n = await repos.notes.save({ title: 'Deep', bodyMd: '[[Other]]' });
    await open(n.id, '?depth=7');
    await fireEvent.press(await screen.findByText('Other'));
    expect(await screen.findByText('other body')).toBeTruthy();
    expect(screen).toHaveSearchParams({ noteId: other.id, depth: '8' });
  });

  it('offers to create a note for a ghost link', async () => {
    const n = await repos.notes.save({ title: 'Self', bodyMd: '[[Nowhere]]' });
    await open(n.id);
    await fireEvent.press(await screen.findByText('Nowhere'));
    expect(await screen.findByText('Create “Nowhere”?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.press(await screen.findByText('Nowhere'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Create note' }));
    expect(await screen.findByDisplayValue('Nowhere')).toBeTruthy();
    expect(await repos.notes.findByTitle('Nowhere')).not.toBeNull();
  });

  it('shows tags as chips that open the tag', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'x' });
    const tag = await repos.tags.save({ name: 'work' });
    await repos.tags.setMembership(n.id, tag, true);
    await open(n.id);
    await fireEvent.press(await screen.findByRole('button', { name: 'Tag work' }));
    expect(await screen.findByText('Tag screen')).toBeTruthy();
  });

  it('shows the conflict banner, which opens the conflict screen', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'x' });
    await db.runAsync(
      `INSERT INTO conflicts (id, note_id, version_id, server_rev, created_at) VALUES ('c1', ?, 'v', 2, 'x')`,
      [n.id],
    );
    await open(n.id);
    await fireEvent.press(
      await screen.findByText('This note was also edited on another device. Your copy is kept.'),
    );
    expect(await screen.findByText('Conflict screen')).toBeTruthy();
  });
});

describe('Note editor: menu and leaving', () => {
  const menu = async (item: string) => {
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: item }));
  };

  it('pins and unpins', async () => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'x' });
    await open(n.id);
    await menu('Pin');
    await waitFor(async () => expect((await stored(n.id))?.isPinned).toBe(true));
    await menu('Unpin');
    await waitFor(async () => expect((await stored(n.id))?.isPinned).toBe(false));
  });

  it.each([
    ['Move to collection', 'Picker screen'],
    ['Tags', 'Tags screen'],
    ['Info', 'Info screen'],
    ['History', 'Versions screen'],
  ])('%s opens its screen', async (item, text) => {
    const n = await repos.notes.save({ title: 'T', bodyMd: 'x' });
    await open(n.id);
    await menu(item);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('moves the note to Trash', async () => {
    const n = await repos.notes.save({ title: 'Doomed', bodyMd: 'x' });
    await open(n.id);
    await menu('Delete');
    await waitFor(async () => expect((await stored(n.id))?.deletedAt).not.toBeNull());
    expect(toastMessage()).toBe('“Doomed” moved to Trash');
  });

  it('back saves, and drops a fresh note left empty', async () => {
    const n = await repos.notes.save({ title: '', bodyMd: '' });
    await open(n.id, '?fresh=1');
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Notes screen')).toBeTruthy();
    await waitFor(async () => expect(await stored(n.id)).toBeNull());
  });

  it('back keeps a fresh note that has text', async () => {
    const n = await repos.notes.save({ title: '', bodyMd: '' });
    await open(n.id, '?fresh=1');
    await fireEvent.changeText(await screen.findByLabelText('Note body'), 'keep me');
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Notes screen')).toBeTruthy();
    await waitFor(async () => expect((await stored(n.id))?.bodyMd).toBe('keep me'));
  });
});
