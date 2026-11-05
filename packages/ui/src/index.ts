// Public surface of @nexus/ui. The full token set from TDD Section C is added
// in Phase 2; these brand colours come from the approved palette.

export const brand = {
  primary: '#3B5BDB',
  accent: '#E8A33D',
  ink: '#1C2340',
} as const;

export type Brand = typeof brand;
