import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import Welcome from '../../app/(auth)/welcome';
import { useSessionStore } from '../../src/stores/session';

// Regression (found by the E2E suite): Welcome stays reachable in local mode,
// so "Continue offline" flipped the session but left people on Welcome.
describe('Welcome → Continue offline', () => {
  it('opens Notes', async () => {
    useSessionStore.setState({ status: 'anon' });
    await renderRouter(
      { welcome: Welcome, notes: () => <Text>Notes screen</Text> },
      { initialUrl: '/welcome' },
    );
    fireEvent.press(screen.getByText('Continue offline'));
    expect(await screen.findByText('Notes screen')).toBeTruthy();
    expect(useSessionStore.getState().status).toBe('local');
  });
});
