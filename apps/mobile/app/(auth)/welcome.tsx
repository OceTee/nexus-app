import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSessionStore } from '../../src/stores/session';
import { Button, Screen, Text } from '../../src/ui';

/** S-01 Welcome: sign in, create an account, or continue offline (Journey 1). */
export default function Welcome() {
  const status = useSessionStore((s) => s.status);
  const continueOffline = useSessionStore((s) => s.continueOffline);

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.hero}>
        <Image
          source={require('../../assets/images/icon.png')}
          style={styles.mark}
          accessibilityIgnoresInvertColors
          accessible={false}
        />
        <Text variant="display" align="center" accessibilityRole="header">
          NEXUS
        </Text>
        <Text variant="body" tone="inkSoft" align="center">
          Your thinking, connected.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label="Create account" onPress={() => router.push('/sign-up')} />
        <Button label="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
        {status === 'local' ? (
          <Button
            label="Back to my notes"
            variant="text"
            onPress={() => router.replace('/notes')}
          />
        ) : (
          <Button label="Continue offline" variant="text" onPress={continueOffline} />
        )}
        <Text variant="footnote" tone="inkFaint" align="center">
          Your notes stay on this device. Syncing between devices needs an account.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  mark: { width: 96, height: 96, borderRadius: 22, marginBottom: 16 },
  actions: { padding: 16, gap: 12 },
});
