import { Image } from 'expo-image';
import { ScrollView, StyleSheet, View } from 'react-native';
import { APP_VERSION } from '@/infra/config';
import { Header, Screen, Text, useTheme } from '@/ui';

/** Main open-source components shipped in the app, with their licences. */
const LICENCES: [string, string][] = [
  ['React Native', 'MIT'],
  ['Expo SDK and Expo Router', 'MIT'],
  ['React', 'MIT'],
  ['SQLite (expo-sqlite)', 'Public domain / MIT'],
  ['Skia (@shopify/react-native-skia)', 'MIT'],
  ['d3-force', 'ISC'],
  ['FlashList', 'MIT'],
  ['TanStack Query', 'MIT'],
  ['Zustand', 'MIT'],
  ['React Hook Form', 'MIT'],
  ['Zod', 'MIT'],
  ['marked', 'MIT'],
  ['fflate', 'MIT'],
  ['Lucide icons', 'ISC'],
  ['Reanimated and Gesture Handler', 'MIT'],
  ['Inter, Source Serif 4, JetBrains Mono', 'SIL Open Font License 1.1'],
];

/** S-38 About and licences. */
export default function About() {
  const t = useTheme();
  return (
    <Screen>
      <Header title="About" />
      <ScrollView contentContainerStyle={styles.pad}>
        <View style={styles.brand}>
          <Image
            source={require('../../../assets/images/icon.png')}
            style={styles.icon}
            accessibilityIgnoresInvertColors
            accessible={false}
          />
          <Text variant="title2">NEXUS</Text>
          <Text variant="callout" tone="inkSoft">
            Version {APP_VERSION}
          </Text>
          <Text variant="callout" tone="inkSoft" align="center">
            Offline-first notes with links, backlinks and a graph of your thinking.
          </Text>
        </View>
        <Text variant="caption" tone="inkSoft" style={styles.section}>
          OPEN-SOURCE LICENCES
        </Text>
        {LICENCES.map(([name, licence]) => (
          <View key={name} style={[styles.row, { borderBottomColor: t.colors.line }]} accessible>
            <Text variant="callout" style={styles.flex}>
              {name}
            </Text>
            <Text variant="footnote" tone="inkSoft">
              {licence}
            </Text>
          </View>
        ))}
        <Text variant="footnote" tone="inkFaint" style={styles.section}>
          Full licence texts ship with each package in the app bundle.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48 },
  brand: { alignItems: 'center', gap: 6, paddingVertical: 16 },
  icon: { width: 72, height: 72, borderRadius: 16 },
  section: { marginTop: 16, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
