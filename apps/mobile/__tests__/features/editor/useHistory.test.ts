import { act, renderHook } from '@testing-library/react-native';
import { useHistory } from '../../../src/features/editor/useHistory';
import type { Edit } from '../../../src/features/editor/textOps';

const edit = (text: string, at = text.length): Edit => ({
  text,
  selection: { start: at, end: at },
});

let clock = 1_000_000;
beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => jest.restoreAllMocks());

const setup = () => renderHook(() => useHistory(edit('')));

describe('useHistory', () => {
  it('starts with nothing to undo or redo', async () => {
    const { result } = await setup();
    expect(result.current).toMatchObject({ present: edit(''), canUndo: false, canRedo: false });
    let out: Edit | null = edit('x');
    await act(async () => {
      out = result.current.undo();
    });
    expect(out).toBeNull();
    await act(async () => {
      out = result.current.redo();
    });
    expect(out).toBeNull();
  });

  it('joins quick typing into one undo step', async () => {
    const { result } = await setup();
    await act(async () => result.current.record(edit('a'), false));
    clock += 100;
    await act(async () => result.current.record(edit('ab'), false));
    clock += 100;
    await act(async () => result.current.record(edit('abc'), false));
    expect(result.current.present.text).toBe('abc');

    let restored: Edit | null = null;
    await act(async () => {
      restored = result.current.undo();
    });
    expect(restored).toEqual(edit(''));
    expect(result.current).toMatchObject({ canUndo: false, canRedo: true });
  });

  it('starts a new step after a pause and for toolbar actions', async () => {
    const { result } = await setup();
    await act(async () => result.current.record(edit('a'), false));
    clock += 900;
    await act(async () => result.current.record(edit('ab'), false));
    await act(async () => result.current.record(edit('**ab**'), true));

    await act(async () => void result.current.undo());
    expect(result.current.present.text).toBe('ab');
    await act(async () => void result.current.undo());
    expect(result.current.present.text).toBe('a');
    await act(async () => void result.current.undo());
    expect(result.current.present.text).toBe('');
  });

  it('redoes undone steps and clears redo on a new edit', async () => {
    const { result } = await setup();
    await act(async () => result.current.record(edit('one'), true));
    await act(async () => result.current.record(edit('two'), true));
    await act(async () => void result.current.undo());

    let redone: Edit | null = null;
    await act(async () => {
      redone = result.current.redo();
    });
    expect(redone).toEqual(edit('two'));
    expect(result.current.canRedo).toBe(false);

    await act(async () => void result.current.undo());
    await act(async () => result.current.record(edit('three'), true));
    expect(result.current).toMatchObject({ canRedo: false, canUndo: true });
  });

  it('moves the selection without an undo step', async () => {
    const { result } = await setup();
    await act(async () => result.current.record(edit('hello'), true));
    await act(async () => result.current.select({ start: 1, end: 3 }));
    expect(result.current.present).toEqual({ text: 'hello', selection: { start: 1, end: 3 } });
    await act(async () => void result.current.undo());
    expect(result.current.present).toEqual(edit(''));
  });

  it('resets without history', async () => {
    const { result } = await setup();
    await act(async () => result.current.record(edit('draft'), true));
    await act(async () => result.current.reset(edit('loaded', 0)));
    expect(result.current).toMatchObject({
      present: edit('loaded', 0),
      canUndo: false,
      canRedo: false,
    });
  });

  it('keeps at most 200 undo steps', async () => {
    const { result } = await setup();
    for (let i = 1; i <= 205; i += 1) {
      await act(async () => result.current.record(edit(String(i)), true));
    }
    for (let i = 0; i < 200; i += 1) await act(async () => void result.current.undo());
    expect(result.current.present.text).toBe('5');
    expect(result.current.canUndo).toBe(false);
  });
});
