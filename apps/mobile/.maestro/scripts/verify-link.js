// Reads the verification email sent to EMAIL (local API in E2E_MODE) and
// returns a deep link the app opens: output.verifyLink = nexus://verify?token=…

const API = typeof API_URL !== 'undefined' ? API_URL : 'http://localhost:4000';

/** Waits for the verification email (sent by a background job) for up to 20 s. */
function lastEmail(to) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const res = http.get(`${API}/v1/dev/emails/last?to=${encodeURIComponent(to)}`);
    if (res.status === 200) return JSON.parse(res.body);
    const until = Date.now() + 500;
    while (Date.now() < until) {
      // wait (Maestro scripts have no sleep)
    }
  }
  throw new Error(`No email for ${to} after 20 s`);
}

const mail = lastEmail(EMAIL);
const token = /[?&]token=([^&\s]+)/.exec(mail.link)[1];
output.verifyLink = `nexus://verify?token=${token}`;
