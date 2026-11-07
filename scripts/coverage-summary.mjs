#!/usr/bin/env node
// Prints a coverage summary per area from an Istanbul json-summary file, and on
// GitHub Actions writes it to the job summary plus one notice annotation, so the
// numbers are readable without downloading artifacts.
//
//   node scripts/coverage-summary.mjs <coverage-summary.json> <label> [depth]
//
// depth: how many path segments name an area (default 3, e.g. src/modules/sync).

import { appendFileSync, readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

const [file, label = 'coverage', depthArg = '3'] = process.argv.slice(2);
if (!file) {
  console.error('usage: coverage-summary.mjs <coverage-summary.json> <label> [depth]');
  process.exit(2);
}
const depth = Number(depthArg);
const summary = JSON.parse(readFileSync(file, 'utf8'));
const { total, ...files } = summary;
const root = process.cwd();

const areas = new Map();
for (const [path, v] of Object.entries(files)) {
  const key = relative(root, path).split(sep).join('/').split('/').slice(0, depth).join('/');
  const a = areas.get(key) ?? { lines: 0, covered: 0, branches: 0, bcovered: 0 };
  a.lines += v.lines.total;
  a.covered += v.lines.covered;
  a.branches += v.branches.total;
  a.bcovered += v.branches.covered;
  areas.set(key, a);
}

const pct = (c, t) => (t === 0 ? 100 : (100 * c) / t).toFixed(1);
const rows = [...areas.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(
    ([k, a]) =>
      `| ${k} | ${a.lines} | ${pct(a.covered, a.lines)} % | ${pct(a.bcovered, a.branches)} % |`,
  );
const head = `Lines ${total.lines.pct} %, branches ${total.branches.pct} %`;
const table = [
  `### ${label}: ${head}`,
  '',
  '| Area | Lines | Line coverage | Branch coverage |',
  '|---|---|---|---|',
  ...rows,
  '',
].join('\n');

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
if (process.env.GITHUB_ACTIONS) {
  const lines = rows
    .map((r) => r.replace(/^\| | \|$/g, '').split(' | '))
    .map((c) => `${c[0]} ${c[2]} lines, ${c[3]} branches`);
  console.log(`::notice title=Coverage ${label}::${head}%0A${lines.join('%0A')}`);
}
