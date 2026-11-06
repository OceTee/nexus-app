#!/usr/bin/env node
// Runs the NEXUS Maestro flows one by one, clearing the app's data with
// `adb shell pm clear` before each (Maestro's own clearState hangs on phones
// with a second user profile, such as XOS dual apps).
//
//   node .maestro/run.mjs [--device <serial>] [--only 04,07] [--include manual]
//                         [--keep-driver]
//
// --keep-driver skips Maestro's driver reinstall, for phones where the driver
// was installed once and exempted from the system's app freezer.
//
// Flows tagged `manual` (needs a finger on the sensor) and `emulator-only`
// (airplane mode cuts wireless adb) are skipped unless --include names them.
// MAESTRO_BIN points at the CLI if `maestro` is not on PATH.

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = 'com.gladprosper.nexus.development';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const device =
  arg('device') ??
  execFileSync('adb', ['devices'], { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .find(([, state]) => state === 'device')?.[0];
if (!device) {
  console.error('No adb device connected.');
  process.exit(2);
}

const only = arg('only')?.split(',');
const include = new Set(arg('include')?.split(',') ?? []);
const skipTags = ['manual', 'emulator-only'].filter((t) => !include.has(t));
const maestro = process.env.MAESTRO_BIN ?? 'maestro';
const keepDriver = args.includes('--keep-driver');
const adb = (...a) => execFileSync('adb', ['-s', device, ...a], { encoding: 'utf8' });

const flows = readdirSync(join(here, 'flows'))
  .filter((f) => f.endsWith('.yaml'))
  .sort()
  .filter((f) => !only || only.some((o) => f.startsWith(o)));

const results = [];
for (const file of flows) {
  const tags = /^tags:\s*\[([^\]]*)\]/m
    .exec(readFileSync(join(here, 'flows', file), 'utf8'))?.[1]
    .split(',')
    .map((t) => t.trim());
  const skipped = tags?.find((t) => skipTags.includes(t));
  if (skipped) {
    results.push({ file, status: `skipped (${skipped})` });
    continue;
  }
  adb('shell', 'pm', 'clear', APP_ID);
  for (const port of ['4000', '8081', '9000']) adb('reverse', `tcp:${port}`, `tcp:${port}`);
  console.log(`\n▶ ${file}`);
  const run = spawnSync(
    maestro,
    [
      '--device',
      device,
      'test',
      ...(keepDriver ? ['--no-reinstall-driver'] : []),
      join(here, 'flows', file),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    },
  );
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  process.stdout.write(out);
  const passed = run.status === 0;
  // The failing step and Maestro's reason, for the summary and CI annotations.
  const reason = passed
    ? ''
    : out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /FAILED|not visible|Assertion|Exception|Error|timed out/i.test(l))
        .slice(-4)
        .join(' | ');
  results.push({ file, status: passed ? 'passed' : 'FAILED', reason });
}

console.log('\nResults');
for (const r of results) {
  console.log(`  ${r.status.padEnd(26)} ${r.file}${r.reason ? `  — ${r.reason}` : ''}`);
}
// On GitHub Actions each failure becomes an annotation, readable without the raw logs.
if (process.env.GITHUB_ACTIONS) {
  const esc = (t) => t.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const r of results.filter((x) => x.status === 'FAILED')) {
    console.log(`::error title=E2E ${r.file}::${esc(r.reason || 'failed (see e2e-results)')}`);
  }
  const passedCount = results.filter((x) => x.status === 'passed').length;
  console.log(
    `::notice title=E2E summary::${passedCount} passed, ${results.length - passedCount} not passed`,
  );
}
process.exit(results.some((r) => r.status === 'FAILED') ? 1 : 0);
