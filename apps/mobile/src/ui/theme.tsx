import { paletteFor, tokens, type ColorScheme, type Palette, type TypeStyle } from '@nexus/ui';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme, type TextStyle } from 'react-native';
import { useSettingsStore } from '../stores/settings';

export interface Theme {
  scheme: ColorScheme;
  colors: Palette;
  space: typeof tokens.space;
  radius: typeof tokens.radius;
  /** Text style for a type token (fonts are embedded under these family names). */
  type: (style: TypeStyle) => TextStyle;
}

const ThemeContext = createContext<Theme | null>(null);

function buildTheme(scheme: ColorScheme): Theme {
  return {
    scheme,
    colors: paletteFor(scheme),
    space: tokens.space,
    radius: tokens.radius,
    type: (style) => {
      const t = tokens.type[style];
      return { fontFamily: t.family, fontSize: t.size, lineHeight: t.lineHeight };
    },
  };
}

/** Picks light or dark from the Appearance setting and the system scheme. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const preference = useSettingsStore((s) => s.theme);
  const scheme: ColorScheme =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const theme = useMemo(() => buildTheme(scheme), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  return theme ?? buildTheme('light');
}

/** `#RRGGBB` at an opacity, for tints such as chip fills and pressed states. */
export function alpha(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

/** Darkens a `#RRGGBB` colour by a fraction (pressed buttons: 10 %). */
export function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.round(c * (1 - amount)));
  const [r, g, b] = [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
