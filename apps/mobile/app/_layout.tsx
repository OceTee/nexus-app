import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { LogBox, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../src/data/queries/client';
import { restoreSession } from '../src/features/auth/authService';
import { openDatabase } from '../src/infra/db';
import { useSessionStore } from '../src/stores/session';
import { Button, Text, ThemeProvider, ToastHost, useTheme } from '../src/ui';

// E2E runs (Maestro) hide development warning toasts that cover the screen.
if (process.env.EXPO_PUBLIC_E2E === '1') LogBox.ignoreAllLogs(true);

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 200 });

/**
 * Root layout (TDD Section G, Expo Router navigation). The splash stays up
 * until the database is open and the session is restored; fonts are embedded
 * at build time, so nothing else is awaited.
 */
export default function RootLayout() {
  const status = useSessionStore((s) => s.status);
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    openDatabase().then(
      () => setDbReady(true),
      (err: unknown) => setDbError(String(err)),
    );
    void restoreSession();
  }, []);

  const ready = (dbReady || dbError !== null) && status !== 'loading';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              {dbError ? <DatabaseError message={dbError} /> : <Routes />}
              <ToastHost />
            </KeyboardProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Routes() {
  const t = useTheme();
  const status = useSessionStore((s) => s.status);
  return (
    <>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.surface } }}
      >
        <Stack.Screen name="index" />
        {/* Signed out, or using the app offline without an account. */}
        <Stack.Protected guard={status !== 'authed'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'authed' || status === 'local'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        {/* Email links: open in any state. */}
        <Stack.Screen name="verify" />
        <Stack.Screen name="reset" />
      </Stack>
    </>
  );
}

function DatabaseError({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: t.colors.surface }]}>
      <Text variant="title2" align="center">
        NEXUS could not open its database
      </Text>
      <Text variant="callout" tone="inkSoft" align="center" style={styles.gap}>
        {message}
      </Text>
      <Button label="Try again" onPress={() => void openDatabase()} block={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  gap: { marginVertical: 16 },
});
