import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { Note, Tag } from '../../../src/data/repos';
import { NoteRow, type NoteRowProps } from '../../../src/features/notes/NoteRow';

interface MockSwipeProps {
  children: ReactNode;
  renderLeftActions: () => ReactNode;
  renderRightActions: () => ReactNode;
}

// The Reanimated swipeable needs native worklets; render both action panels inline instead.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: forwardRef((p: MockSwipeProps, ref: unknown) => {
      useImperativeHandle(ref, () => ({ close: mockClose }));
      return (
        <View>
          {p.renderLeftActions()}
          {p.children}
          {p.renderRightActions()}
        </View>
      );
    }),
  };
});
const mockClose = jest.fn();

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'Kalman',
  bodyMd: '',
  excerpt: 'The filter works.',
  wordCount: 3,
  collectionId: null,
  isPinned: false,
  serverRev: 0,
  localRev: 1,
  dirty: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: new Date().toISOString(),
  deletedAt: null,
  ...over,
});

const tag = (id: string): Tag => ({
  id,
  name: `tag-${id}`,
  colour: null,
  noteCount: 1,
  serverRev: 0,
  dirty: false,
});

const setup = (over: Partial<NoteRowProps> = {}) => {
  const props: NoteRowProps = {
    note: note(),
    tags: [],
    breadcrumb: '',
    conflicted: false,
    onPress: jest.fn(),
    onLongPress: jest.fn(),
    onTogglePin: jest.fn(),
    onDelete: jest.fn(),
    ...over,
  };
  return { props, view: render(<NoteRow {...props} />) };
};

describe('NoteRow', () => {
  it('shows the title, excerpt and a spoken summary', async () => {
    const { view } = setup();
    await view;
    expect(screen.getByText('Kalman')).toBeTruthy();
    expect(screen.getByText('The filter works.')).toBeTruthy();
    expect(screen.getByLabelText('Kalman, Just now')).toBeTruthy();
  });

  it('describes pinned, untitled and conflicted notes', async () => {
    const { view } = setup({
      note: note({ title: '', isPinned: true, excerpt: '' }),
      conflicted: true,
    });
    await view;
    expect(screen.getByLabelText('Untitled, pinned, has a conflict, Just now')).toBeTruthy();
    expect(screen.queryByText('The filter works.')).toBeNull();
  });

  it('shows up to three tags and the breadcrumb', async () => {
    const { view } = setup({ tags: ['a', 'b', 'c', 'd'].map(tag), breadcrumb: 'Work › Projects' });
    await view;
    expect(screen.getByText('tag-a')).toBeTruthy();
    expect(screen.getByText('tag-c')).toBeTruthy();
    expect(screen.queryByText('tag-d')).toBeNull();
    expect(screen.getByText('Work › Projects')).toBeTruthy();
  });

  it('opens on press and the menu on long press', async () => {
    const { props, view } = setup();
    await view;
    const row = screen.getByLabelText('Kalman, Just now');
    await fireEvent.press(row);
    await fireEvent(row, 'longPress');
    expect(props.onPress).toHaveBeenCalledWith(props.note);
    expect(props.onLongPress).toHaveBeenCalledWith(props.note);
  });

  it('closes the swipe and acts from the Pin and Delete panels', async () => {
    const { props, view } = setup({ note: note({ isPinned: true }) });
    await view;
    await fireEvent.press(screen.getByLabelText('Unpin'));
    await fireEvent.press(screen.getByLabelText('Delete'));
    expect(mockClose).toHaveBeenCalledTimes(2);
    expect(props.onTogglePin).toHaveBeenCalledWith(props.note);
    expect(props.onDelete).toHaveBeenCalledWith(props.note);
  });

  it('supports pin and delete as accessibility actions', async () => {
    const { props, view } = setup();
    await view;
    const row = screen.getByLabelText('Kalman, Just now');
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'pin' } });
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(props.onTogglePin).toHaveBeenCalledWith(props.note);
    expect(props.onDelete).toHaveBeenCalledWith(props.note);
  });
});
