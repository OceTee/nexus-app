import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from './Text';
import { useTheme } from './theme';

/** Screen container with the theme background, safe areas and an optional large title. */
export function Screen({
  title,
  children,
  scroll = false,
  form = false,
  edges = ['top', 'left', 'right'],
}: {
  title?: string;
  children: ReactNode;
  scroll?: boolean;
  /** Keyboard-aware scrolling for forms. */
  form?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const t = useTheme();
  const header = title ? (
    <Text variant="title1" accessibilityRole="header" style={styles.title}>
      {title}
    </Text>
  ) : null;
  const body = form ? (
    <KeyboardAwareScrollView
      contentContainerStyle={styles.pad}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      {header}
      {children}
    </KeyboardAwareScrollView>
  ) : scroll ? (
    <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      {header}
      {children}
    </ScrollView>
  ) : (
    <View style={styles.fill}>
      {header ? <View style={styles.headerPad}>{header}</View> : null}
      {children}
    </View>
  );
  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: t.colors.surface }]}>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, paddingBottom: 48 },
  headerPad: { paddingHorizontal: 16, paddingTop: 16 },
  title: { marginBottom: 16 },
});
