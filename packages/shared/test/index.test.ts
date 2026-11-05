import { describe, expect, it } from 'vitest';
import { API_VERSION } from '../src/index';

describe('@nexus/shared', () => {
  it('exposes the API contract version', () => {
    expect(API_VERSION).toBe('1');
  });
});
