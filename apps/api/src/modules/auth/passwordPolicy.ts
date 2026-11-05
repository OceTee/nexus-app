import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';
import { ValidationError } from '../../lib/errors';

// zxcvbn with the common-password and English dictionaries (TDD Section H,
// Password policy: 8–128 characters, score ≥ 2, breached-list check, no
// composition rules). The common dictionary includes the most-used leaked
// passwords, which covers the bundled breached-list requirement.
const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...en.dictionary },
  graphs: common.adjacencyGraphs,
  translations: en.translations,
});

export const MIN_PASSWORD_SCORE = 2;

/**
 * Words a password must not lean on: each context string, the email's local
 * part, each word of the name and the name's words joined together.
 */
function personalWords(context: string[]): string[] {
  const words = new Set<string>();
  for (const raw of context) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    words.add(value);
    const local = value.split('@')[0]!;
    words.add(local);
    const parts = local.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 3);
    parts.forEach((p) => words.add(p));
    if (parts.length > 1) words.add(parts.join(''));
  }
  return [...words];
}

/** Throws 400 VALIDATION_FAILED when the password is too guessable. */
export function assertStrongPassword(password: string, context: string[] = []): void {
  const result = zxcvbn.check(password, personalWords(context));
  if (result.score < MIN_PASSWORD_SCORE) {
    throw new ValidationError([
      {
        path: ['password'],
        issue: 'weak_password',
        message: result.feedback.warning || 'Choose a less common password.',
        score: result.score,
        suggestions: result.feedback.suggestions,
      },
    ]);
  }
}

/** Disposable-email domains refused at registration (small list, updated manually). */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'getnada.com',
  'dispostable.com',
]);

export function assertNotDisposable(email: string): void {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (DISPOSABLE_DOMAINS.has(domain)) {
    throw new ValidationError([
      { path: ['email'], issue: 'disposable_email', message: 'Use a permanent email address.' },
    ]);
  }
}
