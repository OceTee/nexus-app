import {
  assignPaths,
  noteToMarkdown,
  slug,
  yamlString,
  type ExportNote,
} from '../../../src/features/export/serialise';

const note = (over: Partial<ExportNote> = {}): ExportNote => ({
  id: 'n1',
  title: 'Kalman filtering',
  bodyMd: 'Body text',
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-01-03T03:04:05.000Z',
  isPinned: false,
  collectionId: null,
  tagIds: [],
  links: [],
  ...over,
});

describe('yamlString', () => {
  it('leaves plain scalars unquoted', () => {
    expect(yamlString('Kalman filtering')).toBe('Kalman filtering');
    expect(yamlString('Work/Projects')).toBe('Work/Projects');
  });

  it.each(['', 'true', 'No', 'null', '~', '42', '-1.5e3', '- item', 'key: value', 'a # b', 'x '])(
    'quotes %j',
    (s) => {
      expect(yamlString(s)).toBe(`"${s}"`);
    },
  );

  it('escapes quotes, backslashes and control characters', () => {
    expect(yamlString('say "hi"')).toBe('"say \\"hi\\""');
    expect(yamlString('a\\b')).toBe('"a\\\\b"');
    expect(yamlString('l1\nl2\r\tx')).toBe('"l1\\nl2\\r\\tx"');
  });
});

describe('noteToMarkdown', () => {
  it('writes front-matter with empty lists and a null collection', () => {
    expect(noteToMarkdown(note(), '', [])).toBe(
      [
        '---',
        'id: n1',
        'title: Kalman filtering',
        'created: 2026-01-02T03:04:05.000Z',
        'updated: 2026-01-03T03:04:05.000Z',
        'collection: null',
        'tags: []',
        'links: []',
        '---',
        'Body text',
        '',
      ].join('\n'),
    );
  });

  it('lists tags and links, quotes where needed and marks pinned notes', () => {
    const md = noteToMarkdown(
      note({ title: 'true', isPinned: true, links: ['Other note', 'a: b'], bodyMd: 'x\n' }),
      'Work/Projects',
      ['research', 'yes'],
    );
    expect(md).toContain('title: "true"\n');
    expect(md).toContain('collection: Work/Projects\n');
    expect(md).toContain('tags:\n  - research\n  - "yes"\n');
    expect(md).toContain('links:\n  - Other note\n  - "a: b"\n');
    expect(md).toContain('pinned: true\n---\n');
    expect(md.endsWith('---\nx\n')).toBe(true);
  });

  it('keeps an empty body empty', () => {
    expect(noteToMarkdown(note({ bodyMd: '' }), '', []).endsWith('---\n')).toBe(true);
  });
});

describe('slug', () => {
  it('strips accents and path-unsafe characters', () => {
    expect(slug('Café: notes/drafts?')).toBe('Cafe- notes-drafts-');
    expect(slug('a\\b*c|d<e>f"g')).toBe('a-b-c-d-e-f-g');
  });

  it('collapses whitespace and drops leading dots', () => {
    expect(slug('  ..hidden   file  ')).toBe('hidden file');
  });

  it('caps the length at 80 characters', () => {
    expect(slug('x'.repeat(200))).toHaveLength(80);
  });

  it('falls back when nothing is left', () => {
    expect(slug('')).toBe('untitled');
    expect(slug('...', 'file')).toBe('file');
  });
});

describe('assignPaths', () => {
  const pathOf = (id: string | null) => (id === 'c1' ? ['Work', 'Pro/jects'] : []);

  it('puts notes under their collection folders', () => {
    const paths = assignPaths([note({ id: 'a', collectionId: 'c1' }), note({ id: 'b' })], pathOf);
    expect(paths.get('a')).toBe('Work/Pro-jects/Kalman filtering.md');
    expect(paths.get('b')).toBe('Kalman filtering.md');
  });

  it('numbers clashes case-insensitively', () => {
    const paths = assignPaths(
      [
        note({ id: 'a', title: 'Ideas' }),
        note({ id: 'b', title: 'ideas' }),
        note({ id: 'c', title: 'IDEAS' }),
        note({ id: 'd', title: '' }),
      ],
      pathOf,
    );
    expect([...paths.values()]).toEqual([
      'Ideas.md',
      'ideas (2).md',
      'IDEAS (3).md',
      'untitled.md',
    ]);
  });

  it('numbers clashes inside a folder too', () => {
    const paths = assignPaths(
      [note({ id: 'a', collectionId: 'c1' }), note({ id: 'b', collectionId: 'c1' })],
      pathOf,
    );
    expect(paths.get('b')).toBe('Work/Pro-jects/Kalman filtering (2).md');
  });
});
