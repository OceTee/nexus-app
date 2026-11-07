import { validateTagName } from '../../../src/features/tags/validate';

describe('validateTagName', () => {
  it('accepts a trimmed single word', () => {
    expect(validateTagName('  research ')).toBeNull();
    expect(validateTagName('deep-work_2')).toBeNull();
  });

  it.each([
    ['', 'Enter a name'],
    ['   ', 'Enter a name'],
    ['x'.repeat(41), 'Use 40 characters or fewer'],
    ['#todo', 'Leave out the #'],
    ['two words', 'Tags are one word: use - or _ instead of spaces'],
  ])('rejects %j', (input, message) => {
    expect(validateTagName(input)).toBe(message);
  });

  it('allows exactly 40 characters', () => {
    expect(validateTagName('x'.repeat(40))).toBeNull();
  });
});
