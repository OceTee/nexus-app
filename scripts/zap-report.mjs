#!/usr/bin/env node
// Reads a ZAP JSON report, lists every alert (as GitHub annotations in CI) and
// fails when any alert is medium or high risk (TDD T-72).
//
//   node scripts/zap-report.mjs report_json.json

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'report_json.json';
if (!existsSync(file)) {
  console.log(
    `::error title=ZAP::No report at ${file}; the scan did not finish (see the scan step).`,
  );
  process.exit(1);
}

const RISK = ['Informational', 'Low', 'Medium', 'High'];
const report = JSON.parse(readFileSync(file, 'utf8'));
const alerts = (report.site ?? []).flatMap((s) => s.alerts ?? []);
const rows = alerts
  .map((a) => ({
    risk: Number(a.riskcode),
    name: a.name ?? a.alert,
    id: a.pluginid,
    count: Number(a.count ?? a.instances?.length ?? 0),
    where: (a.instances ?? [])
      .slice(0, 3)
      .map((i) => `${i.method} ${i.uri}`)
      .join(', '),
  }))
  .sort((a, b) => b.risk - a.risk);

const blocking = rows.filter((r) => r.risk >= 2);
const counts = RISK.map((label, i) => `${rows.filter((r) => r.risk === i).length} ${label}`)
  .reverse()
  .join(', ');
const lines = [
  `### ZAP API scan: ${counts}`,
  '',
  '| Risk | Alert | Rule | Instances | Examples |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${RISK[r.risk]} | ${r.name} | ${r.id} | ${r.count} | ${r.where} |`),
  '',
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);

if (process.env.GITHUB_ACTIONS) {
  for (const r of rows) {
    const level = r.risk >= 2 ? 'error' : 'notice';
    console.log(
      `::${level} title=ZAP ${RISK[r.risk]}: ${r.name} (${r.id})::${r.count} instance(s). ${r.where}`,
    );
  }
  console.log(`::notice title=ZAP summary::${counts}`);
}
process.exit(blocking.length > 0 ? 1 : 0);
