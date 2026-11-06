import { Stack } from 'expo-router';
import { LockGate } from '../../src/features/auth/LockGate';
import { useTheme } from '../../src/ui';

export const unstable_settings = { anchor: '(tabs)' };

export default function AppLayout() {
  const t = useTheme();
  return (
    <LockGate>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.surface } }}
      />
    </LockGate>
  );
}
