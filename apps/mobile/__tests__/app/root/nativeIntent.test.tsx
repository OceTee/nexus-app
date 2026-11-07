import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { redirectSystemPath } from '../../../app/+native-intent';
import NotFound from '../../../app/+not-found';
import { useSessionStore } from '../../../src/stores/session';
import { resetStores, stub } from '../screen-helpers/setup';

const redirect = (path: string) => redirectSystemPath({ path, initial: true });

beforeEach(resetStores);

describe('+native-intent deep links', () => {
  describe('signed in', () => {
    beforeEach(() => useSessionStore.setState({ status: 'authed' }));

    it.each([
      ['nexus://note/abc', '/note/abc'],
      ['nexus://note/abc/', '/note/abc'],
      ['nexus://search?q=kalman', '/search?q=kalman'],
      ['nexus://graph?tag=t1', '/graph?tag=t1'],
      ['https://app.nexus.example/settings/devices', '/settings/devices'],
      ['https://app.nexus.example/verify?token=abc', '/verify?token=abc'],
      ['https://app.nexus.example', '/'],
      ['/note/abc', '/note/abc'],
    ])('maps %s to %s', (path, route) => {
      expect(redirect(path)).toBe(route);
      expect(useSessionStore.getState().pendingLink).toBeNull();
    });
  });

  it('opens app routes offline-only too', () => {
    useSessionStore.setState({ status: 'local' });
    expect(redirect('nexus://tags')).toBe('/tags');
  });

  it.each(['anon', 'loading'] as const)(
    'keeps an app link for after sign-in while %s',
    (status) => {
      useSessionStore.setState({ status });
      expect(redirect('nexus://note/abc')).toBe('/');
      expect(useSessionStore.getState().pendingLink).toBe('/note/abc');
    },
  );

  it('lets email links through while signed out', () => {
    useSessionStore.setState({ status: 'anon' });
    expect(redirect('https://app.nexus.example/reset?token=t')).toBe('/reset?token=t');
    expect(redirect('nexus://notes-archive')).toBe('/notes-archive');
    expect(useSessionStore.getState().pendingLink).toBeNull();
  });

  it('returns a malformed link unchanged', () => {
    expect(redirect('not a url')).toBe('not a url');
  });
});

describe('+not-found', () => {
  it('explains the dead link and goes to the notes', async () => {
    await renderRouter(
      { '+not-found': NotFound, notes: stub('Notes') },
      { initialUrl: '/nowhere' },
    );
    expect(await screen.findByText('Nothing here')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Go to notes' }));
    expect(await screen.findByText('Notes screen')).toBeTruthy();
  });
});
