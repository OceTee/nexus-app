import type { TypeStyle } from '@nexus/ui';
import { Text as RNText, type TextProps } from 'react-native';
import { useTheme } from './theme';

export interface AppTextProps extends TextProps {
  variant?: TypeStyle;
  /** Palette role for the colour (default ink). */
  tone?: 'ink' | 'inkSoft' | 'inkFaint' | 'primary' | 'danger' | 'success' | 'onPrimary';
  align?: 'left' | 'center' | 'right';
}

/** Text in the NEXUS type scale (TDD Section C, Typography system). */
export function Text({ variant = 'body', tone = 'ink', align, style, ...rest }: AppTextProps) {
  const t = useTheme();
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={rest.maxFontSizeMultiplier ?? 1.6}
      style={[
        t.type(variant),
        { color: t.colors[tone] },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
