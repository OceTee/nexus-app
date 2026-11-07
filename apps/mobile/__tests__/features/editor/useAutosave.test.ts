import { act, renderHook } from '@testing-library/react-native';
import { repos, type Note } from '../../../src/data/repos';
import { AUTOSAVE_MS, noteStamp, useAutosave } from '../../../src/features/editor/useAutosave';

const saved = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 't',
  bodyMd: 'b',
  excerpt: '',
  wordCount: 1,
  collectionId: null,
  isPinned: false,
  serverRev: 0,
  localRev: 3,
  dirty: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  deletedAt: null,
  ...over,
});

let save: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  save = jest.spyOn(repos.notes, 'save').mockResolvedValue(saved());
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const draft = { title: 'Title', bodyMd: 'Body' };

describe('noteStamp', () => {
  it('combines the local revision and timestamp', () => {
    expect(noteStamp({ localRev: 3, updatedAt: '2026-01-02' })).toBe('3|2026-01-02');
  });
});

describe('useAutosave', () => {
  it('saves once, 500 ms after the last change', async () => {
    const { result } = await renderHook(() => useAutosave('n1'));
    expect(result.current.state).toBe('saved');

    await act(async () => result.current.schedule({ title: 'T', bodyMd: 'a' }));
    expect(result.current.state).toBe('pending');
    expect(result.current.isBusy()).toBe(true);
    await act(async () => jest.advanceTimersByTime(AUTOSAVE_MS - 1));
    await act(async () => result.current.schedule(draft));
    await act(async () => jest.advanceTimersByTime(AUTOSAVE_MS - 1));
    expect(save).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ id: 'n1', ...draft });
    expect(result.current.state).toBe('saved');
    expect(result.current.isBusy()).toBe(false);
    expect(result.current.knownStamp()).toBe('3|2026-01-02');
  });

  it('flushes immediately and is a no-op with nothing pending', async () => {
    const { result } = await renderHook(() => useAutosave('n1'));
    await act(() => result.current.flush());
    expect(save).not.toHaveBeenCalled();

    await act(async () => result.current.schedule(draft));
    await act(() => result.current.flush());
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(AUTOSAVE_MS * 2));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a note id', async () => {
    const { result } = await renderHook(() => useAutosave(undefined));
    await act(async () => result.current.schedule(draft));
    await act(() => result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps a failed draft and retries it on the next flush', async () => {
    save.mockRejectedValueOnce(new Error('disk full'));
    const { result } = await renderHook(() => useAutosave('n1'));
    await act(async () => result.current.schedule(draft));
    await act(() => result.current.flush());
    expect(result.current.state).toBe('failed');
    expect(result.current.isBusy()).toBe(true);

    await act(() => result.current.flush());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ id: 'n1', ...draft });
    expect(result.current.state).toBe('saved');
  });

  it('stays pending when another edit arrives during a save', async () => {
    let finish!: (n: Note) => void;
    save.mockImplementationOnce(() => new Promise<Note>((r) => (finish = r)));
    const { result } = await renderHook(() => useAutosave('n1'));
    await act(async () => result.current.schedule(draft));
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.flush();
    });
    expect(result.current.state).toBe('saving');
    await act(async () => result.current.schedule({ title: 'Title', bodyMd: 'Body 2' }));
    await act(async () => {
      finish(saved());
      await first;
    });
    expect(result.current.state).toBe('pending');
  });

  it('records a loaded stamp', async () => {
    const { result } = await renderHook(() => useAutosave('n1'));
    expect(result.current.knownStamp()).toBeNull();
    result.current.markLoaded('1|x');
    expect(result.current.knownStamp()).toBe('1|x');
  });

  it('flushes on unmount', async () => {
    const { result, unmount } = await renderHook(() => useAutosave('n1'));
    await act(async () => result.current.schedule(draft));
    await act(async () => unmount());
    expect(save).toHaveBeenCalledWith({ id: 'n1', ...draft });
  });
});
