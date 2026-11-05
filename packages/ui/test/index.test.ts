import { describe, expect, it } from 'vitest';
import { brand } from '../src/index';

describe('@nexus/ui', () => {
  it('exposes the brand primary colour', () => {
    expect(brand.primary).toBe('#3B5BDB');
  });
});
