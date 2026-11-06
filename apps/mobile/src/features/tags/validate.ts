import { LIMITS } from '@nexus/shared';

/** Tag name rules (S-21/S-22): 1–40 characters, no `#`, no whitespace. */
export function validateTagName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a name';
  if (name.length > LIMITS.tagNameMax) return `Use ${LIMITS.tagNameMax} characters or fewer`;
  if (name.includes('#')) return 'Leave out the #';
  if (/\s/.test(name)) return 'Tags are one word: use - or _ instead of spaces';
  return null;
}
