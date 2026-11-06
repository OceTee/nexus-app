// Reads the verification email sent to EMAIL (local API in E2E_MODE) and
// returns a deep link the app opens: output.verifyLink = nexus://verify?token=…

const API = typeof API_URL !== 'undefined' ? API_URL : 'http://localhost:4000';

const res = http.get(`${API}/v1/dev/emails/last?to=${encodeURIComponent(EMAIL)}`);
if (res.status !== 200) throw new Error(`No email for ${EMAIL}: ${res.status}`);
const mail = JSON.parse(res.body);
const token = /[?&]token=([^&\s]+)/.exec(mail.link)[1];
output.verifyLink = `nexus://verify?token=${token}`;
