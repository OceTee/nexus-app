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

const GRANTS = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.CAMERA',
];

/** The texts on screen right now, so a failure says what was showing instead. */
function screenText() {
  try {
    const xml = execFileSync('adb', ['-s', device, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    const seen = [...xml.matchAll(/(?:text|content-desc)="([^"]+)"/g)].map((m) => m[1]);
    return [...new Set(seen)].slice(0, 25).join(' · ') || '(nothing readable)';
  } catch {
    return '(screen dump failed)';
  }
}

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
  // pm clear also revokes runtime permissions; grant them so no system prompt
  // (Android 13+ notifications, photo access) covers the app mid-flow.
  for (const perm of GRANTS) {
    try {
      adb('shell', 'pm', 'grant', APP_ID, perm);
    } catch {
      // Not declared or not runtime on this Android version.
    }
  }
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
  const screen = passed ? '' : screenText();
  if (!passed) console.log(`Screen at failure: ${screen}`);
  results.push({ file, status: passed ? 'passed' : 'FAILED', reason, screen });
}

console.log('\nResults');
for (const r of results) {
  console.log(`  ${r.status.padEnd(26)} ${r.file}${r.reason ? `  — ${r.reason}` : ''}`);
}
// On GitHub Actions each failure becomes an annotation, readable without the raw logs.
if (process.env.GITHUB_ACTIONS) {
  const esc = (t) => t.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const r of results.filter((x) => x.status === 'FAILED')) {
    console.log(
      `::error title=E2E ${r.file}::${esc(`${r.reason || 'failed'} || SCREEN: ${r.screen}`)}`,
    );
  }
  const count = (pred) => results.filter(pred).length;
  console.log(
    `::notice title=E2E summary::${count((x) => x.status === 'passed')} passed, ` +
      `${count((x) => x.status === 'FAILED')} failed, ` +
      `${count((x) => x.status.startsWith('skipped'))} skipped`,
  );
}
process.exit(results.some((r) => r.status === 'FAILED') ? 1 : 0);
