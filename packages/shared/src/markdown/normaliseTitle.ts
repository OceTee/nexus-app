/**
 * Normalises a note title for matching wiki-links to notes (TDD T-04):
 * Unicode NFC, trim, collapse internal whitespace to one space, lower-case.
 *
 * `normaliseTitle('  Kalman  Filtering ')` → `'kalman filtering'`
 */
export function normaliseTitle(title: string): string {
  return title.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}
