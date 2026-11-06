import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { Text } from './Text';
import { alpha, darken, useTheme } from './theme';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: 'primary' | 'secondary' | 'text' | 'destructive';
  loading?: boolean;
  /** Stretch to the container width (default true except text buttons). */
  block?: boolean;
}

/**
 * Buttons from TDD Section C: 48 pt, radius 12, Inter 600 17 pt; pressed is
 * 10 % darker at scale 0.98; loading keeps the width with a spinner.
 */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  block,
  disabled,
  ...rest
}: ButtonProps) {
  const t = useTheme();
  const isDisabled = Boolean(disabled || loading);
  const fill =
    variant === 'primary'
      ? t.colors.primary
      : variant === 'destructive'
        ? t.colors.danger
        : variant === 'secondary'
          ? t.colors.surface2
          : 'transparent';
  const textTone = variant === 'secondary' ? 'ink' : variant === 'text' ? 'primary' : 'onPrimary';
  const fullWidth = block ?? variant !== 'text';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={variant === 'text' ? 8 : 0}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.block,
        variant === 'text'
          ? styles.text
          : { backgroundColor: isDisabled ? alpha(fill, 0.4) : pressed ? darken(fill, 0.1) : fill },
        variant === 'secondary' &&
          t.scheme === 'light' && { borderWidth: 1, borderColor: t.colors.line },
        { transform: [{ scale: pressed && !isDisabled ? 0.98 : 1 }] },
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            color={
              variant === 'secondary' || variant === 'text' ? t.colors.primary : t.colors.onPrimary
            }
          />
        ) : (
          <Text
            variant="headline"
            tone={textTone}
            style={isDisabled ? { opacity: variant === 'text' ? 0.4 : 0.7 } : null}
          >
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: 12, paddingHorizontal: 20, justifyContent: 'center' },
  block: { alignSelf: 'stretch' },
  text: { minHeight: 44, paddingHorizontal: 4, alignSelf: 'center' },
  content: { alignItems: 'center', justifyContent: 'center' },
});
