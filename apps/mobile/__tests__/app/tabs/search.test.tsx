import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Search from '../../../app/(app)/(tabs)/search/index';
import { repos } from '../../../src/data/repos';
import type { SqlDb } from '../../../src/infra/sql';
import { kvStore } from '../screen-helpers/kvMock';
import { freshDb, renderScreen, resetStores, stub } from '../screen-helpers/setup';

jest.mock('../../../src/infra/kv', () => jest.requireActual('../screen-helpers/kvMock'));

const RECENT_KEY = 'nexus.search.recent';
const routes = { search: Search, 'note/[noteId]': stub('Note') };
const show = (url = '/search') => renderScreen(routes, url);
const input = () => screen.getByLabelText('Search notes');
const type = (q: string) => fireEvent.changeText(input(), q);

let db: SqlDb;
let kalman: string;
let work: string;

beforeEach(async () => {
  resetStores();
  kvStore.clear();
  db = await freshDb();
  work = await repos.collections.save({ name: 'Work' });
  const projects = await repos.collections.save({ name: 'Projects', parentId: work });
  kalman = (
    await repos.notes.save({
      title: 'Kalman filter',
      bodyMd: 'A recursive estimator for noisy sensors.',
      collectionId: projects,
    })
  ).id;
  await repos.notes.save({ title: '', bodyMd: 'Sensors drift over time.' });
});

describe('Search tab', () => {
  it('invites a search before anything is typed', async () => {
    await show();
    expect(await screen.findByText('Search everything')).toBeTruthy();
  });

  it('finds a note by its text, with breadcrumb, and opens it', async () => {
    const r = await show();
    await type('estimator');
    const hit = await screen.findByText('Kalman filter');
    expect(screen.getByText('estimator')).toBeTruthy();
    expect(screen.getByText(/Work › Projects/)).toBeTruthy();
    await fireEvent.press(hit);
    expect(await screen.findByText('Note screen')).toBeTruthy();
    expect(r.getPathname()).toBe(`/note/${kalman}`);
    expect(JSON.parse(kvStore.get(RECENT_KEY)!)).toEqual({ items: ['estimator'] });
  });

  it('labels untitled hits', async () => {
    await show();
    await type('drift');
    expect(await screen.findByText('Untitled')).toBeTruthy();
  });

  it('says when nothing matches', async () => {
    await show();
    await type('zebra');
    expect(await screen.findByText('No results for “zebra”')).toBeTruthy();
    expect(screen.queryByText('Try removing a filter.')).toBeNull();
  });

  it('pre-fills the query from the link', async () => {
    await show('/search?q=kalman');
    expect(await screen.findByText('Kalman filter')).toBeTruthy();
    expect(input().props.value).toBe('kalman');
  });

  it('clears the query', async () => {
    await show();
    await type('kalman');
    await screen.findByText('Kalman filter');
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Search everything')).toBeTruthy();
  });

  it('remembers a submitted search and runs it again from the recent list', async () => {
    await show();
    await type('sensors');
    await screen.findByText('Kalman filter');
    await fireEvent(input(), 'submitEditing');
    await type('');
    expect(await screen.findByText('RECENT SEARCHES')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'sensors' }));
    expect(await screen.findByText('Kalman filter')).toBeTruthy();
  });

  it('shows saved recent searches', async () => {
    kvStore.set(RECENT_KEY, JSON.stringify({ items: ['graph', 'kalman'] }));
    await show();
    expect(await screen.findByRole('button', { name: 'graph' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'kalman' })).toBeTruthy();
  });

  describe('filters', () => {
    it('narrows by tag and can reset to any tag', async () => {
      const tag = await repos.tags.save({ name: 'maths' });
      await repos.tags.setMembership(kalman, tag, true);
      await show();
      await type('sensors');
      await screen.findByText('Kalman filter');
      expect(screen.getByText('Untitled')).toBeTruthy();

      await fireEvent.press(screen.getByRole('button', { name: 'Tag' }));
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'maths' }));
      await waitFor(() => expect(screen.queryByText('Untitled')).toBeNull());
      expect(screen.getByRole('button', { name: 'Tag: maths' }).props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      );

      await fireEvent.press(screen.getByRole('button', { name: 'Tag: maths' }));
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'Any tag' }));
      expect(await screen.findByText('Untitled')).toBeTruthy();
    });

    it('narrows by collection', async () => {
      await show();
      await type('sensors');
      await screen.findByText('Untitled');
      await fireEvent.press(screen.getByRole('button', { name: 'Collection' }));
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'Work' }));
      expect(await screen.findByRole('button', { name: 'Collection: Work' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Collection: Work' }));
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'Work › Projects' }));
      await waitFor(() => expect(screen.queryByText('Untitled')).toBeNull());
      await fireEvent.press(screen.getByRole('button', { name: 'Collection: Projects' }));
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'Any collection' }));
      expect(await screen.findByText('Untitled')).toBeTruthy();
    });

    it('narrows by edit date', async () => {
      await db.runAsync(`UPDATE notes SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`, [
        kalman,
      ]);
      await show();
      await type('sensors');
      await screen.findByText('Kalman filter');
      await fireEvent.press(screen.getByRole('button', { name: 'Date' }));
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'Past week' }));
      await waitFor(() => expect(screen.queryByText('Kalman filter')).toBeNull());
      expect(screen.getByRole('button', { name: 'Date: Past week' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Date: Past week' }));
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'Any time' }));
      expect(await screen.findByText('Kalman filter')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Date' })).toBeTruthy();
    });

    it('narrows to notes with attachments and suggests removing the filter', async () => {
      await show();
      await type('sensors');
      await screen.findByText('Kalman filter');
      await fireEvent.press(screen.getByRole('button', { name: 'Has attachment' }));
      expect(await screen.findByText('No results for “sensors”')).toBeTruthy();
      expect(screen.getByText('Try removing a filter.')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Has attachment' }));
      expect(await screen.findByText('Kalman filter')).toBeTruthy();
    });

    // Regression (fixed): filter chips reuse the tag Chip, whose accessibilityLabel is
    // `Tag ${label}`, so screen readers announce "Tag Collection", "Tag Date"
    // and "Tag Has attachment" for the search filters.
    it('announces filter chips by their own label', async () => {
      await show();
      expect(await screen.findByRole('button', { name: 'Collection' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Date' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Has attachment' })).toBeTruthy();
    });
  });
});
