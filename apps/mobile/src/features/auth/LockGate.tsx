import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import { unlock } from '../../infra/biometrics';
import { useSettingsStore } from '../../stores/settings';
import { Button, Text, useTheme } from '../../ui';

/**
 * S-07 lock (TDD Section G): when the lock is on, the app locks at launch and
 * after being in the background longer than the timeout (default 30 s).
 * Biometrics with the device passcode as fallback; the refresh token never
 * leaves SecureStore, the lock only gates the UI.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const lockEnabled = useSettingsStore((s) => s.lockEnabled);
  const timeout = useSettingsStore((s) => s.lockTimeoutSec);
  const [locked, setLocked] = useState(lockEnabled);
  const backgroundedAt = useRef<number | null>(null);
  const onUnlocked = useCallback(() => setLocked(false), []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current !== null) {
        const away = (Date.now() - backgroundedAt.current) / 1000;
        backgroundedAt.current = null;
        if (useSettingsStore.getState().lockEnabled && away > timeout) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [timeout]);

  return (
    <View style={styles.fill}>
      {children}
      {locked && lockEnabled ? <LockScreen onUnlocked={onUnlocked} /> : null}
    </View>
  );
}

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);

  const attempt = async () => {
    setFailed(false);
    if (await unlock('Unlock NEXUS')) onUnlocked();
    else setFailed(true);
  };

  // Back must not navigate the screens under the lock; it leaves the app instead.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Prompt once on mount; later attempts come from the Unlock button.
  useEffect(() => {
    void unlock('Unlock NEXUS').then((ok) => (ok ? onUnlocked() : setFailed(true)));
  }, [onUnlocked]);

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.lock, { backgroundColor: t.colors.surface }]}
      accessibilityViewIsModal
    >
      <Image
        source={require('../../../assets/images/icon.png')}
        style={styles.mark}
        accessible={false}
      />
      <Text variant="title2" align="center" accessibilityRole="header">
        NEXUS is locked
      </Text>
      <Text variant="callout" tone="inkSoft" align="center">
        {failed
          ? 'Not recognised. Try again or use your passcode.'
          : 'Unlock with your fingerprint, face or passcode.'}
      </Text>
      <View style={styles.button}>
        <Button label="Unlock" onPress={() => void attempt()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  lock: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8, zIndex: 100 },
  mark: { width: 72, height: 72, borderRadius: 16, marginBottom: 16 },
  button: { alignSelf: 'stretch', marginTop: 24 },
});
