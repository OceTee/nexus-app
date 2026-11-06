/**
 * The sentence (or line) around `index` in a Markdown body, whitespace
 * collapsed and cut to `max` characters. Used for backlink context.
 */
export function sentenceAround(body: string, index: number, max = 240): string {
  const before = body.slice(0, index);
  const after = body.slice(index);
  const start = Math.max(before.lastIndexOf('\n') + 1, before.search(/[.!?]\s[^.!?]*$/) + 1, 0);
  const endMatch = /[.!?](\s|$)|\n/.exec(after);
  const end = index + (endMatch ? endMatch.index + 1 : after.length);
  const sentence = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}
