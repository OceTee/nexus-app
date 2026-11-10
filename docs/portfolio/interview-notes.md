# NEXUS interview notes

Talking points and model answers for discussing NEXUS. The answers are short on purpose: say
the first two sentences, then go deeper only if asked. The [case study](case-study.md) and the
[ADRs](../adr/README.md) have the full story.

## Talking points

- **One line:** an offline-first Markdown knowledge base for Android with wiki-links, a graph,
  on-device search and conflict-safe sync, built alone on free plans and released as a signed
  APK (v1.0.1).
- **The interesting part is sync:** an outbox on the device, one `POST /v1/sync` round trip,
  revision checks on the server, conflict copies instead of overwrites, and a merge screen.
- **Security in depth:** Argon2id, 15-minute access tokens, rotating refresh tokens with reuse
  detection, PostgreSQL row-level security, rate limits, a ZAP scan in CI.
- **Evidence, not claims:** 96 % / 90 % line and branch coverage on the app, 92 % / 75 % on the
  API, 12 Maestro flows on an emulator in CI, sync p95 about 220–270 ms at 50 devices against an
  800 ms target, ZAP with no alerts.
- **Honest trade-offs:** free hosting sleeps, Android only, push and backups built but off in the
  demo, and the bugs that tests found late.

## Questions and answers

### Sync and conflicts

**1. Walk me through what happens when I edit a note offline.**
The edit is written to SQLite and, in the same transaction, an operation is queued in the
outbox; further edits to that note merge into the pending operation. When the device is online
again, the app sends up to 100 operations with its cursor in one request. The server applies
each in its own savepoint and returns per-operation results, all changes since the cursor and any
conflicts, which the app applies in one SQLite transaction.

**2. How do you detect a conflict?**
Every note has a server revision, and each edit carries the revision it was based on. If the
base matches, the edit becomes the next revision. If not, the server keeps its copy, stores the
device's text as a conflict version, and tells the device. The row is locked first
(`SELECT … FOR UPDATE`), so two devices syncing the same note are serialised.

**3. Why not CRDTs or last-write-wins?**
Last-write-wins loses text silently, which is the one thing a notes app must not do. CRDTs merge
automatically but add a lot of complexity and make version history harder to explain, for a
single user who rarely edits the same note on two devices at once. Revision checks plus a merge
screen are simpler, transparent and fully testable. Tags and links do merge automatically, as
sets, because that is safe.

**4. What if a request is retried after a timeout?**
Every operation has a client-generated id, and the server records the result per id. A retry
returns the stored result instead of applying the operation twice. Receipts are read and written
once per batch, which was a performance fix from load testing.

**5. What happens if one operation in a batch is bad?**
Only that operation is rejected; the rest still apply because each runs in its own savepoint.
This mattered in practice: a NUL character that PostgreSQL can't store used to fail the whole
request, which would have blocked that device's outbox forever.

**6. What if a device has been offline for months?**
The change feed is compacted after 90 days. A device whose cursor is older gets
`409 CURSOR_TOO_OLD` and bootstraps from a paged snapshot, keeping and then pushing any unsynced
local edits.

### Architecture

**7. Why offline-first rather than a normal online app with caching?**
The users write where the network is worst, and a cache only helps with reads. Making SQLite the
working copy means every screen is fast and works offline, and sync becomes a background concern.
The price is a sync engine and a second data model, which I accepted because it is the product.

**8. Why one container for the API and the workers?**
The job volume is small, so pg-boss keeps its queue in the same PostgreSQL database and runs in
the API process. One thing to deploy, no Redis, and it fits a free plan.

### Security

**9. How does row-level security work here, and why use it if the API already checks the user?**
Every user table has a policy comparing `user_id` with a transaction-local setting,
`app.user_id`. A helper opens each transaction and sets it with `set_config(…, true)`, which is
safe with pooled connections. The API's role can't bypass RLS, so a query that forgets its
`WHERE` clause returns nothing. It is defence in depth, and a test asserts that queries without
the context see zero rows.

**10. Explain refresh-token rotation and reuse detection.**
Access tokens are 15-minute JWTs kept in memory. Refresh tokens are random values; the server
stores only a hash, grouped into a family per device sign-in. Each refresh issues a new token and
revokes the old one. If a revoked token is presented again, someone has a copy, so the server
revokes the whole family, writes an audit event and forces that device to sign in again.

**11. What did the security scan find?**
OWASP ZAP, driven by the generated OpenAPI document, found that a NUL character in
`PATCH /v1/me` caused a 500. That is now a 400, and in sync a per-operation rejection. The
current scan has no high, medium or low alerts.

### Testing and CI

**12. Describe your testing pyramid.**
Many fast unit and component tests (Vitest, Jest with React Native Testing Library); database
tests against real PostgreSQL in Testcontainers, including RLS and a two-client sync simulator;
12 Maestro E2E flows on an Android emulator; and weekly k6 load and ZAP security runs. Each layer
found bugs the others couldn't.

**13. Give an example of a bug only E2E testing found.**
"Continue offline" did nothing because the welcome screen stayed a valid route in local mode.
Another: an intermittent conflict-flow failure where the merge succeeded on the server, but an
older database read finished after a newer one and put stale data back on screen. Only the newest
load may now set state.

**14. How is CI organised?**
Every push and pull request runs lint, type checks, unit and database tests with coverage gates,
gitleaks over the full history, and an OpenAPI lint. E2E runs nightly and when app or API code
changes, against a release build so there is no Metro or dev menu. Load and security tests run
weekly. Render deploys only commits whose checks passed.

**15. How did you deal with flaky E2E tests?**
I treated flakiness as a bug to explain, not to retry away. Causes were real: a client-side race,
Android 14's GWP-ASan crashing the app at random (now opted out), and GitHub release downloads
timing out so Maestro silently failed to install (now fetched through the GitHub API, cached,
and checked). Failures show the on-screen text as CI annotations, so diagnosis is quick.

**16. How did you load test sync, and what did you learn?**
k6 with 50 simulated devices, each pushing 100 operations a minute for 5 minutes, against an
800 ms p95 target; p95 lands around 220–270 ms. It exposed two database round trips per operation
for idempotency receipts, now batched. I also randomised device start times, because devices
that all sync on the same second are not realistic.

### Trade-offs and next steps

**17. What did free plans cost you?**
Render's free service sleeps after 15 idle minutes, so an uptime monitor pings it every 5
minutes. Neon's compute suspends when idle, so the first query can be slow. Resend only delivers
to my own address without a verified domain, so other people can't confirm accounts yet. Push
and encrypted backups are built but need credentials I haven't set up. The same container runs
on a paid host unchanged.

**18. Why Android only?**
iOS builds need a Mac or a paid Apple developer account. The app is Expo, so the code is
cross-platform; the iOS build is a matter of hardware and an account, not a rewrite.

**19. What would you do differently?**
Start E2E on an emulator in CI much earlier: the bugs it found were cheap to fix and expensive to
find. I would also run the load test from the first sync endpoint onwards, so performance work
is driven by measurements from the start rather than at the end.

**20. What would you build next?**
Server-side export jobs, import from Obsidian and Markdown folders, templates and daily notes,
an optional encrypted local database (SQLCipher), and the iOS build. Later, read-only share links
and text search inside attachments.
