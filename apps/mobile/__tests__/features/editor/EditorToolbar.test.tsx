import { fireEvent, render, screen } from '@testing-library/react-native';
import { EditorToolbar } from '../../../src/features/editor/EditorToolbar';

describe('EditorToolbar', () => {
  it.each([
    ['Bold', 'bold'],
    ['Italic', 'italic'],
    ['Heading', 'heading'],
    ['Bulleted list', 'list'],
    ['Task', 'task'],
    ['Code', 'code'],
    ['Link to a note', 'link'],
    ['Attach a file', 'attach'],
    ['Undo', 'undo'],
    ['Redo', 'redo'],
  ])('%s sends "%s"', async (label, action) => {
    const onAction = jest.fn();
    await render(<EditorToolbar onAction={onAction} canUndo canRedo />);
    await fireEvent.press(screen.getByLabelText(label));
    expect(onAction).toHaveBeenCalledWith(action);
  });

  it('disables undo and redo when there is nothing to step to', async () => {
    const onAction = jest.fn();
    await render(<EditorToolbar onAction={onAction} canUndo={false} canRedo={false} />);
    await fireEvent.press(screen.getByLabelText('Undo'));
    await fireEvent.press(screen.getByLabelText('Redo'));
    expect(onAction).not.toHaveBeenCalled();
  });
});
