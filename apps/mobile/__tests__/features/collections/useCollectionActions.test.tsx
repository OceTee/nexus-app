import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { repos, type Collection } from '../../../src/data/repos';
import { useCollectionActions } from '../../../src/features/collections/useCollectionActions';
import { useToastStore } from '../../../src/ui/Toast';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const c = (id: string, parentId: string | null, noteCount = 0): Collection => ({
  id,
  parentId,
  name: id.toUpperCase(),
  icon: null,
  sortOrder: 0,
  noteCount,
  serverRev: 0,
});

let remove: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  remove = jest.spyOn(repos.collections, 'remove').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

function Host({
  all,
  target,
  onDeleted,
}: {
  all: Collection[];
  target: Collection;
  onDeleted?: () => void;
}) {
  const { open, sheet } = useCollectionActions(all, onDeleted);
  return (
    <>
      <Pressable onPress={() => open(target)}>
        <Text>open menu</Text>
      </Pressable>
      {sheet}
    </>
  );
}

const openMenu = async (all: Collection[], target: Collection, onDeleted?: () => void) => {
  await render(<Host all={all} target={target} {...(onDeleted ? { onDeleted } : {})} />);
  await fireEvent.press(screen.getByText('open menu'));
};

describe('useCollectionActions', () => {
  it('routes Rename, Move and Export', async () => {
    const work = c('work', null);
    await openMenu([work], work);
    await fireEvent.press(screen.getByText('Rename'));
    await fireEvent.press(screen.getByText('open menu'));
    await fireEvent.press(screen.getByText('Move'));
    await fireEvent.press(screen.getByText('open menu'));
    await fireEvent.press(screen.getByText('Export collection'));
    expect((router.push as jest.Mock).mock.calls).toEqual([
      [{ pathname: '/collection/edit', params: { id: 'work' } }],
      [{ pathname: '/collection/picker', params: { collectionId: 'work' } }],
      [{ pathname: '/settings/export', params: { collectionId: 'work' } }],
    ]);
  });

  it('deletes an empty collection without asking', async () => {
    const work = c('work', null);
    const onDeleted = jest.fn();
    await openMenu([work], work, onDeleted);
    await fireEvent.press(screen.getByText('Delete'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(remove).toHaveBeenCalledWith('work');
    expect(useToastStore.getState().message).toBe('Deleted “WORK”');
  });

  it.each([
    ['has notes', [c('work', null, 3)]],
    ['has sub-collections', [c('work', null), c('sub', 'work')]],
  ])('asks first when the collection %s', async (_why, all) => {
    await openMenu(all, all[0]!);
    await fireEvent.press(screen.getByText('Delete'));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText('Delete “WORK”?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Move notes to parent and delete'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('work'));
  });

  it('cancels the confirmation', async () => {
    const work = c('work', null, 1);
    await openMenu([work], work);
    await fireEvent.press(screen.getByText('Delete'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(remove).not.toHaveBeenCalled();
  });
});
