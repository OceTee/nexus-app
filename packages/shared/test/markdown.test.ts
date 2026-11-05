import { describe, expect, it } from 'vitest';
import {
  EXCERPT_MAX,
  excerpt,
  findCodeRanges,
  normaliseTitle,
  parseWikiLinks,
  stripMarkdown,
  uniqueLinkTargets,
  WIKI_LINK_MAX_TITLE,
  wordCount,
} from '../src/markdown';

describe('normaliseTitle', () => {
  it('T-04: trims, collapses spaces and lower-cases', () => {
    expect(normaliseTitle('  Kalman  Filtering ')).toBe('kalman filtering');
  });

  it('collapses tabs and newlines and applies NFC', () => {
    expect(normaliseTitle('Café\t\nNotes')).toBe('café notes');
  });
});

describe('parseWikiLinks', () => {
  it('T-01: parses simple links with normalised targets and offsets', () => {
    const body = 'See [[Alpha]] and [[Beta Gamma]]';
    const links = parseWikiLinks(body);
    expect(links.map((l) => l.targetNorm)).toEqual(['alpha', 'beta gamma']);
    expect(links[0]).toMatchObject({ target: 'Alpha', display: 'Alpha', start: 4, end: 13 });
    expect(body.slice(links[1]!.start, links[1]!.end)).toBe('[[Beta Gamma]]');
  });

  it('T-02: ignores links inside fenced code blocks', () => {
    const body = ['Before [[Outside]]', '```ts', 'const x = "[[Inside]]";', '```', 'After'].join(
      '\n',
    );
    expect(parseWikiLinks(body).map((l) => l.target)).toEqual(['Outside']);
  });

  it('ignores links in tilde fences, longer fences and unclosed fences', () => {
    expect(parseWikiLinks('~~~\n[[A]]\n~~~\n[[B]]').map((l) => l.target)).toEqual(['B']);
    expect(parseWikiLinks('````\n```\n[[A]]\n````\n[[B]]').map((l) => l.target)).toEqual(['B']);
    expect(parseWikiLinks('[[B]]\n```\n[[A]]')).toHaveLength(1);
  });

  it('ignores links inside inline code spans', () => {
    expect(parseWikiLinks('Use `[[A]]` or ``x [[B]] y`` but [[C]]').map((l) => l.target)).toEqual([
      'C',
    ]);
  });

  it('treats an unmatched backtick as text', () => {
    expect(parseWikiLinks('a ` b [[C]]').map((l) => l.target)).toEqual(['C']);
  });

  it('T-03: supports alias syntax', () => {
    const [link] = parseWikiLinks('[[Alpha|shown text]]');
    expect(link).toMatchObject({ target: 'Alpha', targetNorm: 'alpha', display: 'shown text' });
  });

  it('falls back to the target when the alias is empty', () => {
    expect(parseWikiLinks('[[Alpha| ]]')[0]?.display).toBe('Alpha');
  });

  it('rejects empty, multi-line, nested and over-long targets', () => {
    expect(parseWikiLinks('[[]] [[ ]] [[|x]]')).toEqual([]);
    expect(parseWikiLinks('[[Split\nLine]]')).toEqual([]);
    expect(parseWikiLinks('[[Outer [[Inner]]').map((l) => l.target)).toEqual(['Inner']);
    expect(parseWikiLinks(`[[${'x'.repeat(WIKI_LINK_MAX_TITLE + 1)}]]`)).toEqual([]);
  });

  it('ignores an opener with no close', () => {
    expect(parseWikiLinks('text [[never closed')).toEqual([]);
  });

  it('collapses whitespace inside targets', () => {
    expect(parseWikiLinks('[[  State   estimation ]]')[0]?.target).toBe('State estimation');
  });

  it('returns nothing quickly for bodies without links', () => {
    expect(parseWikiLinks('plain text')).toEqual([]);
  });

  it('stays linear on pathological input (TM-10)', () => {
    const evil = '[['.repeat(50_000) + ']'.repeat(50_000);
    const t0 = performance.now();
    parseWikiLinks(evil);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('uniqueLinkTargets de-duplicates by normalised target', () => {
    expect(uniqueLinkTargets('[[Alpha]] [[alpha]] [[ALPHA|x]] [[Beta]]')).toEqual([
      'alpha',
      'beta',
    ]);
  });
});

describe('findCodeRanges', () => {
  it('returns fenced blocks and inline spans in order', () => {
    const body = 'a `b` c\n```\nd\n```\ne';
    const ranges = findCodeRanges(body);
    expect(ranges.map((r) => body.slice(r.start, r.end))).toEqual(['`b`', '```\nd\n```']);
  });

  it('does not let a fence of the other character close a block', () => {
    const body = '```\n~~~\n[[A]]\n```';
    expect(findCodeRanges(body)).toEqual([{ start: 0, end: body.length }]);
  });
});

const SAMPLE = [
  '# Kalman filtering',
  '',
  'The **Kalman filter** estimates _state_ from noisy [measurements](https://x.example).',
  '',
  '- Predict step',
  '- Update step with [[State estimation|estimation]]',
  '1. First',
  '> A quoted line',
  '',
  '```python',
  'x = predict(x)',
  '```',
  '',
  '---',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '![diagram](d.png) <br> ~~old~~ `inline`',
].join('\n');

describe('stripMarkdown', () => {
  it('removes Markdown syntax and keeps prose', () => {
    const text = stripMarkdown(SAMPLE);
    expect(text).not.toMatch(/[#*>`[\]|]/);
    expect(text).toContain(
      'Kalman filtering The Kalman filter estimates state from noisy measurements',
    );
    expect(text).toContain('Update step with estimation');
    expect(text).toContain('x = predict(x)');
    expect(text).toContain('diagram');
    expect(text).toContain('old inline');
  });

  it('handles CRLF line endings and task lists', () => {
    expect(stripMarkdown('- [x] done\r\n- [ ] todo')).toBe('done todo');
  });
});

describe('wordCount and excerpt', () => {
  it('T-07: counts words excluding Markdown syntax', () => {
    expect(wordCount('# Title\n\n- one *two*\n- three')).toBe(4);
    expect(wordCount('')).toBe(0);
    expect(wordCount('--- \n # ')).toBe(0);
    expect(wordCount(SAMPLE)).toBeGreaterThan(20);
  });

  it('T-07: excerpt is at most 240 characters and has no heading marks', () => {
    const long = `# Heading\n\n${'word '.repeat(200)}`;
    const ex = excerpt(long);
    expect(ex.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(ex).not.toContain('#');
    expect(ex.endsWith('…')).toBe(true);
  });

  it('returns short bodies unchanged', () => {
    expect(excerpt('## Short note')).toBe('Short note');
  });

  it('cuts mid-word when there is no reasonable word boundary', () => {
    const ex = excerpt('x'.repeat(500), 20);
    expect(ex).toBe(`${'x'.repeat(19)}…`);
  });
});
