// Plays "device B" against the local API for the two-device scenarios.
//   ACTION=edit    appends EDIT_TEXT to the note titled TITLE (T-50)
//   ACTION=revoke  removes every other device of the account (T-53)
//   ACTION=expect  fails unless the note titled TITLE contains EXPECT (T-49, T-50)
//   ACTION=uploaded fails unless the note titled TITLE has an uploaded attachment (T-51)
// Needs EMAIL and PASSWORD (the account the phone is signed in to).

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

const session = call('POST', '/v1/auth/login', {
  email: EMAIL,
  password: PASSWORD,
  device: { id: uuidv7(), name: 'Device B', platform: 'android', appVersion: '1.0.0' },
});
const token = session.accessToken;

function noteByTitle(title) {
  const list = call('GET', '/v1/notes?limit=200', undefined, token);
  const hit = list.items.find((n) => n.title === title);
  if (!hit) throw new Error(`No note titled "${title}" on the server`);
  return call('GET', `/v1/notes/${hit.id}`, undefined, token);
}

if (ACTION === 'edit') {
  const note = noteByTitle(TITLE);
  call(
    'PATCH',
    `/v1/notes/${note.id}`,
    { baseRev: note.serverRev, bodyMd: `${note.bodyMd.trimEnd()}\n\n${EDIT_TEXT}\n` },
    token,
  );
} else if (ACTION === 'revoke') {
  const devices = call('GET', '/v1/devices', undefined, token).items;
  for (const d of devices) {
    if (!d.isCurrent) call('DELETE', `/v1/devices/${d.id}`, undefined, token);
  }
} else if (ACTION === 'expect') {
  const note = noteByTitle(TITLE);
  if (!note.bodyMd.includes(EXPECT)) {
    throw new Error(`Server copy of "${TITLE}" lacks "${EXPECT}": ${note.bodyMd}`);
  }
} else if (ACTION === 'uploaded') {
  const note = noteByTitle(TITLE);
  const list = call('GET', `/v1/attachments?noteId=${note.id}`, undefined, token);
  if (!list.items.some((a) => a.status === 'uploaded')) {
    throw new Error(`No uploaded attachment on "${TITLE}"`);
  }
} else {
  throw new Error(`Unknown ACTION ${ACTION}`);
}
