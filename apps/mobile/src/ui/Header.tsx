import { router } from 'expo-router';
import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useTheme } from './theme';

/** 44 pt square icon button with an accessible label. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  colour,
  disabled = false,
  size = 22,
  width = 44,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  colour?: string;
  disabled?: boolean;
  size?: number;
  /** Narrower buttons for dense toolbars; height stays 44 for touch. */
  width?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.icon,
        { width },
        pressed && { backgroundColor: t.colors.surfacePressed },
        disabled && styles.disabled,
      ]}
    >
      <Icon size={size} color={colour ?? t.colors.ink} />
    </Pressable>
  );
}

/**
 * Compact stack header (TDD Section C): back chevron, a title or custom
 * centre content, and trailing actions.
 */
export function Header({
  title,
  children,
  right,
  onBack,
  backLabel = 'Back',
}: {
  title?: string;
  children?: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.bar, { borderBottomColor: t.colors.line }]}>
      <IconButton
        icon={ChevronLeft}
        label={backLabel}
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/notes')))}
        size={26}
      />
      <View style={styles.centre}>
        {children ??
          (title ? (
            <Text variant="headline" numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
          ) : null)}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  centre: { flex: 1, paddingHorizontal: 4 },
  right: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
});
