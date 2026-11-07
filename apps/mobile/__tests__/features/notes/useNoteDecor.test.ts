import { renderHook, waitFor } from '@testing-library/react-native';
import { repos, type Collection } from '../../../src/data/repos';
import { collectionPath, useNoteDecor } from '../../../src/features/notes/useNoteDecor';
import { setDbForTests } from '../../../src/infra/db';
import { createTestDb } from '../../../src/test/nodeSqlite';

describe('collectionPath', () => {
  const c = (id: string, parentId: string | null): Collection => ({
    id,
    parentId,
    name: id.toUpperCase(),
    icon: null,
    sortOrder: 0,
    noteCount: 0,
    serverRev: 0,
  });
  const map = (...cs: Collection[]) => new Map(cs.map((x) => [x.id, x]));

  it('returns the root-first ancestry including the collection', () => {
    const all = map(c('work', null), c('proj', 'work'), c('alpha', 'proj'));
    expect(collectionPath(all, 'alpha').map((x) => x.id)).toEqual(['work', 'proj', 'alpha']);
  });

  it('is empty for no collection or an unknown id', () => {
    expect(collectionPath(map(), null)).toEqual([]);
    expect(collectionPath(map(), 'missing')).toEqual([]);
  });

  it('stops at a missing parent and caps cycles at 16', () => {
    expect(collectionPath(map(c('orphan', 'gone')), 'orphan').map((x) => x.id)).toEqual(['orphan']);
    expect(collectionPath(map(c('a', 'b'), c('b', 'a')), 'a')).toHaveLength(16);
  });
});

describe('useNoteDecor', () => {
  beforeEach(async () => {
    setDbForTests(await createTestDb());
  });

  it('starts empty, then loads tags per note and breadcrumbs', async () => {
    const work = await repos.collections.save({ name: 'Work' });
    const proj = await repos.collections.save({ name: 'Projects', parentId: work });
    const n = await repos.notes.save({ title: 'N', bodyMd: '', collectionId: proj });
    const t1 = await repos.tags.save({ name: 'one' });
    const t2 = await repos.tags.save({ name: 'two' });
    await repos.tags.setMembership(n.id, t1, true);
    await repos.tags.setMembership(n.id, t2, true);

    const { result } = await renderHook(() => useNoteDecor());
    await waitFor(() => expect(result.current.tagsByNote.size).toBe(1));
    expect(
      result.current.tagsByNote
        .get(n.id)!
        .map((t) => t.name)
        .sort(),
    ).toEqual(['one', 'two']);
    expect(result.current.breadcrumb(proj)).toBe('Work › Projects');
    expect(result.current.breadcrumb(null)).toBe('');
    expect(result.current.collections.size).toBe(2);
    expect(result.current.conflicted.size).toBe(0);
  });
});
