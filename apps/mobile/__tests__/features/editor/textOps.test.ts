import {
  activeWikiQuery,
  code,
  completeWiki,
  insert,
  togglePrefix,
  wrap,
} from '../../../src/features/editor/textOps';

const sel = (start: number, end = start) => ({ start, end });

describe('wrap', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(wrap('make bold now', sel(5, 9), '**')).toEqual({
      text: 'make **bold** now',
      selection: sel(7, 11),
    });
  });

  it('inserts a selected placeholder for an empty selection', () => {
    expect(wrap('ab', sel(1), '_')).toEqual({ text: 'a_text_b', selection: sel(2, 6) });
    expect(wrap('', sel(0), '[', ']', 'label')).toEqual({
      text: '[label]',
      selection: sel(1, 6),
    });
  });

  it('unwraps an already wrapped selection', () => {
    expect(wrap('make **bold** now', sel(7, 11), '**')).toEqual({
      text: 'make bold now',
      selection: sel(5, 9),
    });
  });
});

describe('togglePrefix', () => {
  it('adds a prefix to the current line and shifts the cursor', () => {
    expect(togglePrefix('one\ntwo', sel(5), '# ')).toEqual({
      text: 'one\n# two',
      selection: sel(7),
    });
  });

  it('removes the prefix when every touched line has it', () => {
    expect(togglePrefix('- a\n- b', sel(0, 7), '- ')).toEqual({
      text: 'a\nb',
      selection: sel(0, 3),
    });
  });

  it('adds to every line when only some have it', () => {
    expect(togglePrefix('- a\nb', sel(0, 5), '- ').text).toBe('- a\n- b');
  });

  it('replaces another list or heading prefix', () => {
    expect(togglePrefix('## Title', sel(8), '- [ ] ')).toEqual({
      text: '- [ ] Title',
      selection: sel(11),
    });
    expect(togglePrefix('1. item', sel(3), '- ').text).toBe('- item');
    expect(togglePrefix('- [x] done', sel(10), '# ').text).toBe('# done');
  });

  it('never moves the selection before the line start', () => {
    expect(togglePrefix('x\n# h', sel(2), '# ')).toEqual({ text: 'x\nh', selection: sel(2) });
  });
});

describe('insert', () => {
  it('replaces the selection and puts the cursor after', () => {
    expect(insert('hello world', sel(6, 11), 'there')).toEqual({
      text: 'hello there',
      selection: sel(11),
    });
  });

  it('supports a custom cursor offset', () => {
    expect(insert('', sel(0), '[[]]', 2)).toEqual({ text: '[[]]', selection: sel(2) });
  });
});

describe('code', () => {
  it('uses inline code for a one-line selection', () => {
    expect(code('run npm i', sel(4, 9))).toEqual({ text: 'run `npm i`', selection: sel(5, 10) });
  });

  it('inserts a fence at the start of a line', () => {
    expect(code('', sel(0))).toEqual({ text: '```\n\n```\n', selection: sel(4) });
  });

  it('starts a new line when mid-line and fences a multi-line selection', () => {
    expect(code('x a\nb', sel(2, 5))).toEqual({
      text: 'x \n```\na\nb\n```\n',
      selection: sel(7, 10),
    });
  });
});

describe('activeWikiQuery', () => {
  it('finds the open [[ before the cursor', () => {
    expect(activeWikiQuery('see [[Kal', 9)).toEqual({ start: 4, query: 'Kal' });
    expect(activeWikiQuery('[[', 2)).toEqual({ start: 0, query: '' });
  });

  it('returns null without an open link', () => {
    expect(activeWikiQuery('plain text', 10)).toBeNull();
    expect(activeWikiQuery('[[Done]] more', 13)).toBeNull();
    expect(activeWikiQuery('[[line\nbreak', 12)).toBeNull();
    expect(activeWikiQuery('[[alias|x', 9)).toBeNull();
  });

  it('only looks back a bounded distance', () => {
    const text = `[[${'x'.repeat(300)}`;
    expect(activeWikiQuery(text, text.length)).toBeNull();
    const near = `${'y'.repeat(300)}[[abc`;
    expect(activeWikiQuery(near, near.length)).toEqual({ start: 300, query: 'abc' });
  });
});

describe('completeWiki', () => {
  it('replaces the typed query with the full link', () => {
    expect(completeWiki('see [[Kal and', 4, 9, 'Kalman filter')).toEqual({
      text: 'see [[Kalman filter]] and',
      selection: sel(21),
    });
  });

  it('swallows an already typed closing ]]', () => {
    expect(completeWiki('[[Ka]] x', 0, 4, 'Kalman').text).toBe('[[Kalman]] x');
  });
});
