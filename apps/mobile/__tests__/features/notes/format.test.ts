import {
  formatBytes,
  fullDate,
  relativeDate,
  TAG_COLOURS,
} from '../../../src/features/notes/format';

describe('relativeDate', () => {
  // Local time so the day boundaries match the function's own.
  const now = new Date(2026, 10, 7, 15, 0, 0); // Sat 7 Nov 2026, 15:00
  const at = (y: number, m: number, d: number, h = 12, min = 0) =>
    new Date(y, m, d, h, min).toISOString();

  it('says "Just now" under a minute', () => {
    expect(relativeDate(new Date(now.getTime() - 30_000).toISOString(), now)).toBe('Just now');
  });

  it('counts minutes under an hour', () => {
    expect(relativeDate(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('5 min ago');
  });

  it('shows a time for earlier today', () => {
    const iso = at(2026, 10, 7, 9, 5);
    expect(relativeDate(iso, now)).toBe(
      new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('says "Yesterday" for the previous day', () => {
    expect(relativeDate(at(2026, 10, 6, 1, 0), now)).toBe('Yesterday');
  });

  it('shows the weekday within the last week', () => {
    const iso = at(2026, 10, 3);
    expect(relativeDate(iso, now)).toBe(
      new Date(iso).toLocaleDateString(undefined, { weekday: 'short' }),
    );
  });

  it('shows day and month this year, and the year for older dates', () => {
    const thisYear = at(2026, 0, 15);
    expect(relativeDate(thisYear, now)).toBe(
      new Date(thisYear).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    );
    const lastYear = at(2025, 10, 3);
    expect(relativeDate(lastYear, now)).toBe(
      new Date(lastYear).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    );
  });
});

describe('fullDate', () => {
  it('includes the year', () => {
    expect(fullDate(new Date(2026, 2, 4, 10, 30).toISOString())).toContain('2026');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [30 * 1024 + 300, '30 KB'],
    [4.2 * 1_048_576, '4.2 MB'],
    [1.1 * 1_073_741_824, '1.1 GB'],
  ])('%d bytes → %s', (n, out) => {
    expect(formatBytes(n)).toBe(out);
  });
});

it('offers eight distinct tag colours', () => {
  expect(new Set(TAG_COLOURS).size).toBe(8);
});
