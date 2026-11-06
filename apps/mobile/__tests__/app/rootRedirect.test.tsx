import { renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import Index from '../../app/index';
import { useSessionStore } from '../../src/stores/session';

// Regression: signed in, "/" used to resolve to nothing and showed "Nothing here".
const routes = {
  index: Index,
  welcome: () => <Text>Welcome screen</Text>,
  notes: () => <Text>Notes screen</Text>,
};

describe('root route', () => {
  it.each([
    ['anon', 'Welcome screen'],
    ['local', 'Notes screen'],
    ['authed', 'Notes screen'],
  ] as const)('sends %s sessions to the right screen', async (status, text) => {
    useSessionStore.setState({ status });
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText(text)).toBeTruthy();
  });
});
