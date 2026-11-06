/** "Just now", "5 min ago", "14:02", "Yesterday", "Mon", "3 Nov", "3 Nov 2025". */
export function relativeDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (d.getTime() >= startOfToday) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getTime() >= startOfToday - day) return 'Yesterday';
  if (d.getTime() >= startOfToday - 6 * day) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return d.toLocaleDateString(
    undefined,
    d.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  );
}

/** Full date and time for info sheets. */
export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Tag colours offered by the tag editor (S-22); legible on both themes. */
export const TAG_COLOURS = [
  '#3B5BDB',
  '#E8A33D',
  '#1E7F4F',
  '#B91C1C',
  '#7C3AED',
  '#0E7490',
  '#BE185D',
  '#64748B',
] as const;

/** "512 B", "30 KB", "4.2 MB", "1.1 GB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${Math.round(n / 1024)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}
