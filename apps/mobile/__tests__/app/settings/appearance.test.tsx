import { fireEvent, screen } from 'expo-router/testing-library';
import About from '../../../app/(app)/settings/about';
import Appearance from '../../../app/(app)/settings/appearance';
import { APP_VERSION } from '../../../src/infra/config';
import { useSettingsStore } from '../../../src/stores/settings';
import { renderScreen, resetStores } from '../screen-helpers/setup';

beforeEach(resetStores);

describe('Appearance', () => {
  const show = () => renderScreen({ 'settings/appearance': Appearance }, '/settings/appearance');

  it('switches the theme', async () => {
    await show();
    const system = await screen.findByRole('tab', { name: 'System' });
    expect(system.props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('tab', { name: 'Dark' }));
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(screen.getByRole('tab', { name: 'Dark' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Light' }));
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('changes the editor text size and previews it', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Large' }));
    expect(useSettingsStore.getState().editorFontSize).toBe(18);
    const sample = screen.getByText(/double brackets/);
    expect(sample.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ fontSize: 18, lineHeight: 26 })]),
    );
  });

  it('toggles high contrast and serif reading', async () => {
    await show();
    await fireEvent(
      await screen.findByRole('switch', { name: 'High contrast' }),
      'valueChange',
      true,
    );
    expect(useSettingsStore.getState().highContrast).toBe(true);
    await fireEvent(
      screen.getByRole('switch', { name: 'Serif in Read mode' }),
      'valueChange',
      false,
    );
    expect(useSettingsStore.getState().serifReading).toBe(false);
  });
});

describe('About', () => {
  it('shows the version and the open-source licences', async () => {
    await renderScreen({ 'settings/about': About }, '/settings/about');
    expect(await screen.findByText(`Version ${APP_VERSION}`)).toBeTruthy();
    expect(screen.getByText('OPEN-SOURCE LICENCES')).toBeTruthy();
    expect(screen.getByText('d3-force')).toBeTruthy();
    expect(screen.getByText('SIL Open Font License 1.1')).toBeTruthy();
  });
});
