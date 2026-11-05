// Public surface of @nexus/ui: design tokens and helpers. UI primitives
// (Button, Chip, SyncPill, …) are added with the mobile screens.

export {
  tokens,
  paletteFor,
  type Tokens,
  type ColorScheme,
  type Palette,
  type TypeStyle,
  type Space,
} from './tokens';
export { contrastRatio, luminance } from './contrast';

/** Brand colours from the approved palette (Cobalt, Amber, Ink). */
export const brand = {
  primary: '#3B5BDB',
  accent: '#E8A33D',
  ink: '#1C2340',
} as const;

export type Brand = typeof brand;
