import { describe, expect, it } from 'vitest';
import { emailLink } from '../../src/modules/auth/auth.service';

describe('emailLink', () => {
  it('keeps a path in APP_URL (GitHub Pages project sites)', () => {
    expect(emailLink('https://ocetee.github.io/nexus-app', 'verify', 'abc')).toBe(
      'https://ocetee.github.io/nexus-app/verify?token=abc',
    );
    expect(emailLink('https://ocetee.github.io/nexus-app/', 'reset', 'abc')).toBe(
      'https://ocetee.github.io/nexus-app/reset?token=abc',
    );
  });

  it('works for a bare origin and encodes the token', () => {
    expect(emailLink('https://app.nexus.example', 'verify', 'a+b/c')).toBe(
      'https://app.nexus.example/verify?token=a%2Bb%2Fc',
    );
  });
});
