import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSettingsStore } from '@/stores/settings';
import { Card, Header, Screen, SegmentedControl, Text, useTheme } from '@/ui';

const SIZES = [
  { value: '14', label: 'Small' },
  { value: '16', label: 'Default' },
  { value: '18', label: 'Large' },
  { value: '20', label: 'Larger' },
] as const;

/** S-34 Appearance: theme, editor text size, high contrast and serif reading. */
export default function Appearance() {
  const t = useTheme();
  const s = useSettingsStore();

  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void, hint: string) => (
    <View style={[styles.row, { borderBottomColor: t.colors.line }]}>
      <View style={styles.flex}>
        <Text variant="body">{label}</Text>
        <Text variant="footnote" tone="inkSoft">
          {hint}
        </Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.colors.primary, false: t.colors.line }}
      />
    </View>
  );

  return (
    <Screen>
      <Header title="Appearance" />
      <ScrollView contentContainerStyle={styles.pad}>
        <Text variant="caption" tone="inkSoft" style={styles.section}>
          THEME
        </Text>
        <SegmentedControl
          label="Theme"
          value={s.theme}
          onChange={(theme) => s.update({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          EDITOR TEXT SIZE
        </Text>
        <SegmentedControl
          label="Editor text size"
          value={String(s.editorFontSize) as (typeof SIZES)[number]['value']}
          onChange={(v) => s.update({ editorFontSize: Number(v) })}
          options={SIZES}
        />
        <Card style={styles.sample}>
          <Text
            style={{ fontSize: s.editorFontSize, lineHeight: Math.round(s.editorFontSize * 1.45) }}
          >
            Notes link with [[double brackets]], and every note works offline.
          </Text>
        </Card>
        <Text variant="footnote" tone="inkFaint">
          The rest of the app follows the text size set for your phone.
        </Text>

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          READING
        </Text>
        {toggle(
          'High contrast',
          s.highContrast,
          (highContrast) => s.update({ highContrast }),
          'Darker secondary text and lines',
        )}
        {toggle(
          'Serif in Read mode',
          s.serifReading,
          (serifReading) => s.update({ serifReading }),
          'Source Serif for long reading',
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48 },
  section: { marginTop: 20, marginBottom: 8 },
  sample: { marginVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1, gap: 2 },
});
