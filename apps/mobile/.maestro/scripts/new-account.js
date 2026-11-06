// Creates a fresh, email-verified account through the local API (E2E_MODE)
// and hands its credentials to the flow as output.email / output.password.
// Maestro scripts run on the host, so localhost is the API itself.

const API = typeof API_URL !== 'undefined' ? API_URL : 'http://localhost:4000';

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

function call(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = http.request(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method} ${path} → ${res.status}: ${res.body}`);
  }
  return res.body ? JSON.parse(res.body) : null;
}

const email = `e2e-${Date.now()}@example.com`;
const password = 'Maestro-Flow-Passphrase-42';
call('POST', '/v1/auth/register', {
  email,
  password,
  displayName: 'E2E Tester',
  device: { id: uuidv7(), name: 'E2E setup', platform: 'android', appVersion: '1.0.0' },
});
const mail = call('GET', `/v1/dev/emails/last?to=${encodeURIComponent(email)}`);
const token = /[?&]token=([^&\s]+)/.exec(mail.link)[1];
call('POST', '/v1/auth/verify-email', { token: decodeURIComponent(token) });

output.email = email;
output.password = password;
