// T-62 / TT-31: sync load test (TDD Section L, Performance testing).
// 50 virtual devices (10 accounts × 5 devices) each push a batch of 100 note
// ops once a minute for 5 minutes. Pass: p95 of POST /v1/sync ≤ 800 ms
// (NFR-05) and no errors.
//
//   k6 run -e API_URL=http://localhost:4000 scripts/k6/sync-load.js
//
// Accounts are created in setup() and verified through the API's E2E-only
// email endpoint, so the target must run with E2E_MODE=true (CI or staging).

import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';

const API = __ENV.API_URL || 'http://localhost:4000';
const ACCOUNTS = Number(__ENV.ACCOUNTS || 10);
const DEVICES_PER_ACCOUNT = Number(__ENV.DEVICES_PER_ACCOUNT || 5);
const OPS_PER_BATCH = Number(__ENV.OPS_PER_BATCH || 100);
const PERIOD_S = Number(__ENV.PERIOD_S || 60);
const PASSWORD = 'k6-Load-Test-Passphrase-42';

const DEVICES = ACCOUNTS * DEVICES_PER_ACCOUNT;

export const options = {
  setupTimeout: '5m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
  scenarios: {
    // One device alone, back to back: the cost of a 100-op batch without contention.
    baseline: {
      executor: 'per-vu-iterations',
      exec: 'baseline',
      vus: 1,
      iterations: 10,
      maxDuration: '2m',
    },
    // The load itself. Devices start at random points in the first minute, as
    // real devices do, instead of all syncing on the same second.
    devices: {
      executor: 'constant-vus',
      startTime: __ENV.LOAD_START || '1m',
      vus: DEVICES,
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    'http_req_duration{name:sync}': ['p(95)<800'],
    'http_req_duration{name:sync_single}': ['p(95)<800'],
    'http_req_failed{name:sync}': ['rate==0'],
    checks: ['rate==1'],
  },
};

function uuidv7() {
  const hex = (n) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const h =
    Date.now().toString(16).padStart(12, '0') +
    '7' +
    hex(3) +
    (8 + Math.floor(Math.random() * 4)).toString(16) +
    hex(15);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function post(path, body, token, name) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return http.post(`${API}${path}`, JSON.stringify(body), { headers, tags: { name } });
}

function device(name) {
  return { id: uuidv7(), name, platform: 'android', appVersion: '1.0.0' };
}

/** Creates the accounts and signs in every device; returns one session per VU. */
export function setup() {
  const sessions = [];
  for (let a = 0; a < ACCOUNTS; a += 1) {
    const email = `k6-${Date.now()}-${a}@example.com`;
    const reg = post(
      '/v1/auth/register',
      { email, password: PASSWORD, device: device('k6 setup') },
      null,
      'setup',
    );
    if (reg.status !== 201 && reg.status !== 200) fail(`register ${reg.status}: ${reg.body}`);

    // The verification email is sent by a background job: poll for it.
    let link = null;
    for (let i = 0; i < 40 && !link; i += 1) {
      const res = http.get(`${API}/v1/dev/emails/last?to=${encodeURIComponent(email)}`, {
        tags: { name: 'setup' },
      });
      if (res.status === 200) link = res.json('link');
      else sleep(0.5);
    }
    if (!link) fail(`no verification email for ${email}`);
    const token = decodeURIComponent(/[?&]token=([^&\s]+)/.exec(link)[1]);
    const ver = post('/v1/auth/verify-email', { token }, null, 'setup');
    if (ver.status >= 300) fail(`verify ${ver.status}: ${ver.body}`);

    // Signed in after verification, so every token carries a verified account.
    // The first account gets one more device, for the baseline scenario.
    for (let d = 0; d < DEVICES_PER_ACCOUNT + (a === 0 ? 1 : 0); d += 1) {
      const dev = device(`k6 device ${d + 1}`);
      const login = post(
        '/v1/auth/login',
        { email, password: PASSWORD, device: dev },
        null,
        'setup',
      );
      if (login.status !== 200) fail(`login ${login.status}: ${login.body}`);
      sessions.push({ deviceId: dev.id, accessToken: login.json('accessToken') });
    }
  }
  return { sessions };
}

// Per-VU state survives between iterations.
let cursor = 0;
const notes = []; // { id, rev }

function pushBatch(me, name) {
  // Half new notes, half edits of this device's own notes (once it has some).
  const ops = [];
  for (let i = 0; i < OPS_PER_BATCH; i += 1) {
    const edit = notes.length > 0 && i % 2 === 1;
    const target = edit ? notes[Math.floor(Math.random() * notes.length)] : null;
    const id = target ? target.id : uuidv7();
    ops.push({
      opId: uuidv7(),
      createdAt: new Date().toISOString(),
      type: 'note.upsert',
      entityId: id,
      baseRev: target ? target.rev : 0,
      payload: {
        title: `Load note ${id.slice(-6)}`,
        bodyMd: `Iteration ${exec.vu.iterationInScenario}, op ${i}.\n\nSome body text for the load test.`,
        collectionId: null,
        isPinned: false,
        tagIds: [],
      },
    });
  }
  // One op per note per batch, as a device's outbox coalesces them.
  const seen = new Set();
  const batch = ops.filter((o) => !seen.has(o.entityId) && seen.add(o.entityId));

  const res = post(
    '/v1/sync',
    { deviceId: me.deviceId, cursor, ops: batch, clientSchema: 1 },
    me.accessToken,
    name,
  );
  const ok = check(res, {
    'sync 200': (r) => r.status === 200,
    'every op applied': (r) =>
      r.status === 200 && r.json('results').every((x) => x.status === 'applied'),
  });
  if (res.status === 200) {
    cursor = res.json('cursor');
    const revs = new Map(res.json('results').map((x) => [x.opId, x.serverRev]));
    for (const op of batch) {
      const rev = revs.get(op.opId);
      const known = notes.find((n) => n.id === op.entityId);
      if (known) known.rev = rev;
      else notes.push({ id: op.entityId, rev });
    }
  } else if (!ok) {
    console.error(`sync ${res.status}: ${res.body}`);
  }
}

/** The baseline device: the extra session at the end of the list. */
export function baseline(data) {
  pushBatch(data.sessions[data.sessions.length - 1], 'sync_single');
}

export default function (data) {
  // VU ids are unique across scenarios; the modulo maps them onto the 50 devices.
  const me = data.sessions[(exec.vu.idInTest - 1) % DEVICES];
  if (exec.vu.iterationInScenario === 0) sleep(Math.random() * PERIOD_S);
  const started = Date.now();
  pushBatch(me, 'sync');
  sleep(Math.max(0, PERIOD_S - (Date.now() - started) / 1000));
}

export function handleSummary(data) {
  const line = (label, name) => {
    const d = data.metrics[`http_req_duration{name:${name}}`];
    if (!d) return `${label}: no data`;
    const v = d.values;
    return `${label}: ${v.count} requests; p95 ${v['p(95)'].toFixed(0)} ms, median ${v.med.toFixed(0)} ms, max ${v.max.toFixed(0)} ms`;
  };
  const failed = data.metrics['http_req_failed{name:sync}'];
  const text = [
    line('One device alone (100-op batch)', 'sync_single'),
    line(`${DEVICES} devices, 100 ops/min each`, 'sync'),
    `Failed requests: ${failed ? (failed.values.rate * 100).toFixed(2) : '?'} %`,
  ].join('\n');
  return {
    stdout: `\n${text}\n`,
    'k6-summary.json': JSON.stringify(data, null, 2),
    'k6-summary.txt': `${text}\n`,
  };
}
