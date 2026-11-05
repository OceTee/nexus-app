import { describe, expect, it } from 'vitest';
import { brand, contrastRatio, luminance, paletteFor, tokens } from '../src/index';

const { light, dark } = tokens.color;

describe('tokens match TDD Section C', () => {
  it('uses the approved palette', () => {
    expect(light).toMatchObject({
      primary: '#3B5BDB',
      accent: '#E8A33D',
      ink: '#1C2340',
      inkSoft: '#4A5170',
      inkFaint: '#8C92A8',
      line: '#D9DCE6',
      surface: '#FFFFFF',
      surface2: '#F3F4F8',
      success: '#1E7F4F',
      danger: '#B91C1C',
    });
    expect(dark).toMatchObject({
      primary: '#5C7CFA',
      onPrimary: '#0F1424',
      ink: '#E6E8F0',
      inkSoft: '#A3A8BD',
      line: '#2E3A5C',
      surface: '#0F1424',
      surface2: '#161C33',
      surfacePressed: '#1E2745',
      codeBackground: '#0B0F1C',
    });
    expect(brand.primary).toBe(light.primary);
  });

  it('light and dark palettes define the same roles', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('keeps the minimum touch target at 44 pt and the 4 pt spacing grid', () => {
    expect(tokens.hit.min).toBe(44);
    for (const v of Object.values(tokens.space)) expect(v % 4).toBe(0);
  });

  it('paletteFor picks the scheme and falls back to light', () => {
    expect(paletteFor('dark')).toBe(dark);
    expect(paletteFor('light')).toBe(light);
    expect(paletteFor(null)).toBe(light);
  });
});

describe('contrast (WCAG 2.2 AA)', () => {
  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(() => luminance('blue')).toThrow(RangeError);
  });

  it.each([
    ['light text on surface', light.ink, light.surface],
    ['light secondary text on surface', light.inkSoft, light.surface],
    ['light primary on surface', light.primary, light.surface],
    ['light on-primary on primary', light.onPrimary, light.primary],
    ['light text on surface 2', light.ink, light.surface2],
    ['light success', light.success, light.surface],
    ['light danger', light.danger, light.surface],
    ['dark text on surface', dark.ink, dark.surface],
    ['dark secondary text on surface 2', dark.inkSoft, dark.surface2],
    ['dark primary on surface', dark.primary, dark.surface],
    ['dark on-primary on primary', dark.onPrimary, dark.primary],
    ['dark success', dark.success, dark.surface],
    ['dark danger', dark.danger, dark.surface],
    ['ink on amber banner', light.ink, light.accent],
  ])('%s meets 4.5:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('faint ink is only for large text and non-text (≥ 3:1)', () => {
    expect(contrastRatio(light.inkFaint, light.surface)).toBeGreaterThanOrEqual(3);
  });
});
