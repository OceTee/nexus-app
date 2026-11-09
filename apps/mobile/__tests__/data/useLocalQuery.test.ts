import { act, renderHook, waitFor } from '@testing-library/react-native';
import { events } from '../../src/data/events';
import { useLocalQuery } from '../../src/data/useLocalQuery';

/** A query whose answers the test releases by hand, in any order. */
function controlledQuery() {
  const pending: ((v: string) => void)[] = [];
  const query = jest.fn(() => new Promise<string>((resolve) => pending.push(resolve)));
  return { query, pending };
}

describe('useLocalQuery', () => {
  it('loads once, then again when a table it reads is written', async () => {
    let n = 0;
    const { result } = await renderHook(() => useLocalQuery(['notes'], async () => ++n));
    await waitFor(() => expect(result.current.data).toBe(1));
    await act(async () => events.emit('tags'));
    await act(async () => events.emit('notes'));
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  // Regression (found by the E2E conflict flow): two writes in a row started
  // two loads; when the older one finished last, its stale answer replaced
  // the newer one (the "edited on another device" banner stayed after a merge).
  it('keeps the newest answer when loads finish out of order', async () => {
    const { query, pending } = controlledQuery();
    const { result } = await renderHook(() => useLocalQuery(['notes', 'conflicts'], query));
    await act(async () => pending[0]!('initial'));
    expect(result.current.data).toBe('initial');

    await act(async () => events.emit('notes')); // load #2: still sees the open conflict
    await act(async () => events.emit('conflicts')); // load #3: sees it resolved
    await act(async () => pending[2]!('resolved'));
    await act(async () => pending[1]!('stale'));

    expect(result.current.data).toBe('resolved');
  });

  it('reports errors from the newest load only', async () => {
    const { query, pending } = controlledQuery();
    const failing = jest.fn(() => Promise.reject(new Error('older failure')));
    let useFailing = false;
    const { result } = await renderHook(() =>
      useLocalQuery(['notes'], () => (useFailing ? failing() : query())),
    );
    await act(async () => pending[0]!('ok'));

    useFailing = true;
    await act(async () => events.emit('notes')); // fails
    useFailing = false;
    await act(async () => events.emit('notes')); // succeeds later
    await act(async () => pending[1]!('newer'));

    expect(result.current.data).toBe('newer');
    expect(result.current.error).toBeNull();
  });

  it('stops listening once unmounted', async () => {
    let n = 0;
    const { result, unmount } = await renderHook(() => useLocalQuery(['notes'], async () => ++n));
    await waitFor(() => expect(result.current.data).toBe(1));
    await unmount();
    await act(async () => events.emit('notes'));
    expect(n).toBe(1);
  });
});
