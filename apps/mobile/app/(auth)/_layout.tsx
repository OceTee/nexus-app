import { Stack } from 'expo-router';
import { useTheme } from '../../src/ui';

export default function AuthLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.surface },
        // Native screens set the status bar themselves; follow the app's theme,
        // not the system's (dark mode had dark, unreadable status-bar icons).
        statusBarStyle: t.scheme === 'dark' ? 'light' : 'dark',
      }}
    />
  );
}
