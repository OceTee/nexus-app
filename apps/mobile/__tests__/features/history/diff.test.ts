import { diffLines, mergeDraft, wordDelta } from '../../../src/features/history/diff';

describe('diffLines', () => {
  it('marks unchanged, removed and added lines in order', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('reports trailing additions and removals', () => {
    expect(diffLines('a', 'a\nb\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'b' },
      { kind: 'added', text: 'c' },
    ]);
    expect(diffLines('a\nb\nc', 'a')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'removed', text: 'c' },
    ]);
  });

  it('keeps the longest common subsequence', () => {
    const out = diffLines('1\n2\n3\n4', '0\n2\n4\n5');
    expect(out.filter((l) => l.kind === 'same').map((l) => l.text)).toEqual(['2', '4']);
    expect(out.filter((l) => l.kind === 'removed').map((l) => l.text)).toEqual(['1', '3']);
    expect(out.filter((l) => l.kind === 'added').map((l) => l.text)).toEqual(['0', '5']);
  });

  it('returns everything unchanged for identical text', () => {
    expect(diffLines('x\ny', 'x\ny').every((l) => l.kind === 'same')).toBe(true);
  });

  it('falls back to remove-all then add-all for very large inputs', () => {
    const text = Array.from({ length: 2001 }, (_, i) => `a${i}`).join('\n');
    const out = diffLines(text, text);
    expect(out).toHaveLength(4002);
    expect(out[0]).toEqual({ kind: 'removed', text: 'a0' });
    expect(out[2001]).toEqual({ kind: 'added', text: 'a0' });
  });
});

describe('wordDelta', () => {
  it('formats gains, losses and no change', () => {
    expect(wordDelta('one two', 'one two three four')).toBe('+2');
    expect(wordDelta('one two three', 'one')).toBe('−2');
    expect(wordDelta('a b', 'c d')).toBe('±0');
  });

  it('counts empty and whitespace-only text as zero words', () => {
    expect(wordDelta('', '   ')).toBe('±0');
    expect(wordDelta('  ', 'hello  world ')).toBe('+2');
  });
});

describe('mergeDraft', () => {
  it('returns the server text when this device added nothing new', () => {
    const server = 'Intro\n\nBody';
    expect(mergeDraft(server, 'Body\n\n\nIntro')).toBe(server);
  });

  it('appends paragraphs only this device had under a rule', () => {
    expect(mergeDraft('Intro\n\nShared\n', 'Shared\n\nMine one\n\n  Mine two  ')).toBe(
      'Intro\n\nShared\n\n---\n\nMine one\n\nMine two\n',
    );
  });

  it('ignores blank paragraphs', () => {
    expect(mergeDraft('A', '\n\n\n\nA\n\n\n')).toBe('A');
  });
});
