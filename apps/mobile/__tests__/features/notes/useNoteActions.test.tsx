import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { repos, type Note } from '../../../src/data/repos';
import { deleteNote, togglePin, useNoteActions } from '../../../src/features/notes/useNoteActions';
import { useToastStore } from '../../../src/ui/Toast';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'Kalman',
  bodyMd: '',
  excerpt: '',
  wordCount: 0,
  collectionId: null,
  isPinned: false,
  serverRev: 0,
  localRev: 1,
  dirty: false,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  deletedAt: null,
  ...over,
});

let trash: jest.SpyInstance;
let setPinned: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  trash = jest.spyOn(repos.notes, 'trashNote').mockResolvedValue(undefined);
  setPinned = jest.spyOn(repos.notes, 'setPinned').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('deleteNote and togglePin', () => {
  it('moves a note to Trash with a toast', async () => {
    await deleteNote(note({ title: '' }));
    expect(trash).toHaveBeenCalledWith('n1');
    expect(useToastStore.getState().message).toBe('“Untitled” moved to Trash');
  });

  it('flips the pin', async () => {
    await togglePin(note({ isPinned: true }));
    expect(setPinned).toHaveBeenCalledWith('n1', false);
  });
});

function Host({ target }: { target: Note }) {
  const { open, sheet } = useNoteActions();
  return (
    <>
      <Pressable onPress={() => open(target)}>
        <Text>open menu</Text>
      </Pressable>
      {sheet}
    </>
  );
}

describe('useNoteActions', () => {
  const openMenu = async (target: Note) => {
    await render(<Host target={target} />);
    await fireEvent.press(screen.getByText('open menu'));
  };

  it('pins an unpinned note', async () => {
    await openMenu(note());
    expect(screen.getByText('Kalman')).toBeTruthy();
    await fireEvent.press(screen.getByText('Pin'));
    expect(setPinned).toHaveBeenCalledWith('n1', true);
  });

  it('offers Unpin for a pinned note', async () => {
    await openMenu(note({ isPinned: true, title: '' }));
    expect(screen.getByText('Untitled')).toBeTruthy();
    await fireEvent.press(screen.getByText('Unpin'));
    expect(setPinned).toHaveBeenCalledWith('n1', false);
  });

  it('opens the collection picker and the tag editor', async () => {
    await openMenu(note());
    await fireEvent.press(screen.getByText('Move to collection'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/collection/picker',
      params: { noteId: 'n1' },
    });
    await fireEvent.press(screen.getByText('open menu'));
    await fireEvent.press(screen.getByText('Tags'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/note/[noteId]/tags',
      params: { noteId: 'n1' },
    });
  });

  it('deletes', async () => {
    await openMenu(note());
    await fireEvent.press(screen.getByText('Delete'));
    expect(trash).toHaveBeenCalledWith('n1');
  });
});
