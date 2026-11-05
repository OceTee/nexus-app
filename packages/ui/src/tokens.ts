// Design tokens from TDD Section C (Design tokens; Light and dark mode
// specifications). Styling uses StyleSheet.create with these values; a
// `useTheme()` hook in the app picks `color.light` or `color.dark`.

export const tokens = {
  color: {
    light: {
      primary: '#3B5BDB',
      onPrimary: '#FFFFFF',
      accent: '#E8A33D',
      ink: '#1C2340',
      inkSoft: '#4A5170',
      inkFaint: '#8C92A8',
      line: '#D9DCE6',
      surface: '#FFFFFF',
      surface2: '#F3F4F8',
      surfacePressed: '#E8EAF1',
      codeBackground: '#F3F4F8',
      success: '#1E7F4F',
      danger: '#B91C1C',
      selection: 'rgba(59,91,219,0.12)',
    },
    dark: {
      primary: '#5C7CFA',
      onPrimary: '#0F1424',
      accent: '#E8A33D',
      ink: '#E6E8F0',
      inkSoft: '#A3A8BD',
      inkFaint: '#6B7190',
      line: '#2E3A5C',
      surface: '#0F1424',
      surface2: '#161C33',
      surfacePressed: '#1E2745',
      codeBackground: '#0B0F1C',
      success: '#4ADE80',
      danger: '#F87171',
      selection: 'rgba(92,124,250,0.18)',
    },
  },
  space: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 },
  radius: { sm: 8, md: 10, lg: 12, xl: 14, sheet: 20, pill: 999 },
  type: {
    display: { family: 'InterDisplay-SemiBold', size: 34, lineHeight: 40 },
    title1: { family: 'Inter-SemiBold', size: 28, lineHeight: 34 },
    title2: { family: 'Inter-SemiBold', size: 22, lineHeight: 28 },
    headline: { family: 'Inter-SemiBold', size: 17, lineHeight: 22 },
    body: { family: 'Inter-Regular', size: 17, lineHeight: 24 },
    bodySerif: { family: 'SourceSerif4-Regular', size: 17, lineHeight: 27 },
    callout: { family: 'Inter-Regular', size: 15, lineHeight: 20 },
    footnote: { family: 'Inter-Regular', size: 13, lineHeight: 18 },
    caption: { family: 'Inter-Medium', size: 12, lineHeight: 16 },
    mono: { family: 'JetBrainsMono-Regular', size: 14, lineHeight: 20 },
  },
  shadow: {
    sheet: {
      shadowColor: '#1C2340',
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: -4 },
      elevation: 8,
    },
    fab: {
      shadowColor: '#1C2340',
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
  },
  motion: {
    fast: 120,
    base: 200,
    slow: 320,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    spring: { damping: 18, stiffness: 180 },
  },
  hit: { min: 44 },
} as const;

export type Tokens = typeof tokens;
export type ColorScheme = keyof Tokens['color'];
export type Palette = { readonly [K in keyof Tokens['color']['light']]: string };
export type TypeStyle = keyof Tokens['type'];
export type Space = keyof Tokens['space'];

/** Returns the palette for a colour scheme (`light` when the scheme is unknown). */
export function paletteFor(scheme: ColorScheme | null | undefined): Palette {
  return scheme === 'dark' ? tokens.color.dark : tokens.color.light;
}
