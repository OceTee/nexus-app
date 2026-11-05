// k6 smoke test for POST /v1/sync (TDD Phase 5 acceptance: 10 virtual devices,
// p95 under 800 ms). Each virtual user signs in as the demo account on its own
// device, then pushes a note edit and pulls changes in a loop.
//
//   k6 run -e API_URL=http://localhost:4000 -e PASSWORD=... scripts/k6/sync-smoke.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const API = __ENV.API_URL || 'http://localhost:4000';
const EMAIL = __ENV.EMAIL || 'demo@nexus.example';
const PASSWORD = __ENV.PASSWORD;

export const options = {
  vus: 10,
  duration: __ENV.DURATION || '30s',
  thresholds: {
    'http_req_duration{name:sync}': ['p(95)<800'],
    checks: ['rate>0.99'],
  },
};

// UUIDv7: 48-bit millisecond timestamp, version 7, variant 10.
function uuidv7() {
  const hex = Date.now().toString(16).padStart(12, '0');
  const rest = uuidv4().replace(/-/g, '').slice(12);
  const s =
    hex +
    '7' +
    rest.slice(1, 4) +
    ((parseInt(rest[4], 16) & 0x3) | 0x8).toString(16) +
    rest.slice(5, 20);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const json = { headers: { 'content-type': 'application/json' } };
let session;
let noteId;
let rev = 0;
let cursor = 0;

export default function () {
  if (!session) {
    const device = {
      id: uuidv7(),
      name: `k6 VU ${__VU}`,
      platform: 'android',
      appVersion: '1.0.0',
    };
    const res = http.post(
      `${API}/v1/auth/login`,
      JSON.stringify({ email: EMAIL, password: PASSWORD, device }),
      json,
    );
    check(res, { 'login 200': (r) => r.status === 200 });
    session = { token: res.json('accessToken'), deviceId: device.id };
    noteId = uuidv7();
  }
  const op = {
    opId: uuidv7(),
    createdAt: new Date().toISOString(),
    type: 'note.upsert',
    entityId: noteId,
    baseRev: rev,
    payload: {
      title: `k6 note ${__VU}`,
      bodyMd: `Iteration ${__ITER} links to [[Kalman filtering]].`,
      collectionId: null,
      isPinned: false,
      tagIds: [],
    },
  };
  const res = http.post(
    `${API}/v1/sync`,
    JSON.stringify({ deviceId: session.deviceId, cursor, ops: [op], clientSchema: 1 }),
    {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      tags: { name: 'sync' },
    },
  );
  check(res, {
    'sync 200': (r) => r.status === 200,
    'op applied': (r) => r.json('results.0.status') === 'applied',
  });
  if (res.status === 200) {
    rev = res.json('results.0.serverRev');
    cursor = res.json('cursor');
  }
  sleep(1);
}
