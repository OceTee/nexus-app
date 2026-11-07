import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import TabsLayout from '../../../app/(app)/(tabs)/_layout';
import { stub } from '../screen-helpers/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const routes = {
  '(tabs)/_layout': TabsLayout,
  '(tabs)/notes/index': stub('Notes'),
  '(tabs)/collections/index': stub('Collections'),
  '(tabs)/graph/index': stub('Graph'),
  '(tabs)/search/index': stub('Search'),
  '(tabs)/settings/index': stub('Settings'),
};

describe('Tabs layout', () => {
  it('starts on Notes and labels every tab', async () => {
    await renderRouter(routes, { initialUrl: '/notes' });
    expect(await screen.findByText('Notes screen')).toBeTruthy();
    for (const name of ['Notes', 'Collections', 'Graph', 'Search', 'Settings']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it.each(['Collections', 'Graph', 'Search', 'Settings'])('switches to %s', async (name) => {
    await renderRouter(routes, { initialUrl: '/notes' });
    await screen.findByText('Notes screen');
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(name) }));
    expect(await screen.findByText(`${name} screen`)).toBeTruthy();
  });
});
