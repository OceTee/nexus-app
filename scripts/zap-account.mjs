#!/usr/bin/env node
// Creates a verified throwaway account on an API running with E2E_MODE=true and
// writes its access token to the GitHub step output `token` (masked in logs).
//
//   node scripts/zap-account.mjs http://localhost:4000

import { appendFileSync } from 'node:fs';

const api = process.argv[2] ?? 'http://localhost:4000';
const email = `zap-${Date.now()}@example.com`;
const password = 'Zap-Scan-Passphrase-42';

function uuidv7() {
  const hex = [...crypto.getRandomValues(new Uint8Array(10))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const h = `${Date.now().toString(16).padStart(12, '0')}7${hex.slice(0, 3)}${(8 + (parseInt(hex[3], 16) % 4)).toString(16)}${hex.slice(4, 19)}`;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
const device = () => ({ id: uuidv7(), name: 'ZAP', platform: 'android', appVersion: '1.0.0' });

async function post(path, body) {
  const res = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

await post('/v1/auth/register', { email, password, device: device() });
// The verification email is sent by a background job: poll for it.
let link;
for (let i = 0; i < 40 && !link; i += 1) {
  const res = await fetch(`${api}/v1/dev/emails/last?to=${encodeURIComponent(email)}`);
  if (res.ok) link = (await res.json()).link;
  else await new Promise((r) => setTimeout(r, 500));
}
if (!link) throw new Error(`No verification email for ${email}`);
await post('/v1/auth/verify-email', { token: new URL(link).searchParams.get('token') });
const { accessToken } = await post('/v1/auth/login', { email, password, device: device() });

console.log(`::add-mask::${accessToken}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `token=${accessToken}\n`);
console.log(`Scan account ${email} ready.`);
