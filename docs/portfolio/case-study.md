# NEXUS: building an offline-first notes app on free plans

NEXUS is a personal knowledge base for Android: Markdown notes, `[[wiki-links]]` with backlinks,
a knowledge graph, on-device full-text search, version history and sync between devices. I
designed and built it alone, from a technical design document to a signed v1.0.1 APK on GitHub
Releases. This is what I built, why it is shaped the way it is, and what went wrong on the way.

## The problem

People who think in writing keep notes on several devices and write where networks are worst:
trains, planes, client sites. Most notes apps treat the phone as a window onto the server. When
the signal drops, search stops, edits hang, or two devices disagree and one version silently
wins.

I wanted an app where the phone is where the work happens, the network is optional, and the app
never throws away text, even when two devices edited the same note.

## Who it is for

I designed around three people: a researcher who links papers to concepts and searches them on a
train, a consultant who takes meeting notes on flights and exports a client's notes at the end
of an engagement, and an engineer who keeps runbooks in Markdown and checks version history after
a bad edit. All three are single users with several devices; shared workspaces and real-time
collaboration are out of scope.

## Constraints

- **One developer.** Every piece of infrastructure is something I have to run, debug and pay for
  with my time, so I kept the number of moving parts low.
- **Free plans only.** The API runs on Render's free plan, the database on Neon's free plan,
  attachments on Backblaze B2's free 10 GB, email on Resend's free plan. No credit card anywhere.
- **Android only.** iOS needs a Mac or a paid Apple developer account, so the app is written to
  be cross-platform (Expo) but only the Android build ships.
- **A demo that has to work between interviews** without me touching it.

## Architecture

The app is Expo SDK 58 (React Native 0.88) with Expo Router. Every note, collection, tag, link
and attachment reference lives in SQLite on the device, with FTS5 for search. Screens read only
from SQLite, so nothing in the UI waits on the network.

The backend is a single Docker container: an Express 5 API in TypeScript plus pg-boss workers
for scheduled maintenance (pruning versions, compacting the change feed, purging deleted
accounts). It talks to PostgreSQL 18 on Neon through Drizzle ORM, signs S3 URLs so the app
uploads attachments directly to B2, and sends email through Resend. There are no WebSockets:
sync is request and response, optionally nudged by a silent push (built, but off in the hosted
demo until it has push credentials).

Security is layered. Passwords are hashed with Argon2id. Access tokens are 15-minute JWTs kept in
memory; refresh tokens rotate on every use, and presenting an old one revokes that device's whole
token family. Every user table has PostgreSQL row-level security keyed on a transaction-local
`app.user_id`, and the API's database role cannot bypass it, so a query that forgets its
`WHERE user_id = …` returns nothing rather than someone else's notes.

In the pnpm and Turborepo monorepo, a shared package holds the Zod schemas, the wiki-link parser
and the merge rules, so the app and the API validate operations with the same code.

## The sync design

Sync is the heart of the project, and I kept it deliberately boring.

**Outbox.** Every local write updates SQLite and queues one operation per entity in an outbox,
in the same transaction. If I edit a note ten times while offline, the ten edits coalesce into
one pending operation. A sync runs 5 seconds after the last write, on reconnect, on foreground,
on a silent push, or every 15 minutes.

**One round trip.** The app sends up to 100 operations and its change-feed cursor in one
`POST /v1/sync`. The response carries a result per operation, every change since the cursor and
any new conflicts. The app applies all of it, plus the new cursor, in one SQLite transaction.

**Revision checks.** Every note has a server revision, and each edit carries the revision it
started from. If they match, the edit becomes the next revision. The server locks the row first,
so two devices syncing the same note at once are serialised.

**Conflict copies, not CRDTs.** If the base revision is stale, the server keeps its own copy
untouched and stores the device's text as a conflict version, so nothing is lost or silently
overwritten. CRDTs were the wrong trade for one user with occasional concurrent edits: much more
complexity and harder-to-explain history, to avoid a merge screen most people rarely see.

**Merge.** The app shows a banner on a conflicted note. The resolve screen shows the server's
copy and this device's copy side by side; the person keeps one or merges both by editing, and
the resolution syncs like any other edit.

**Safety rails.** Each operation runs in its own savepoint, so one bad operation is rejected
without blocking the rest. Each operation id is recorded with its result, so a retried request
returns the stored result instead of applying twice. Tags and links merge as sets, so tags added
on two offline devices both survive.

## Testing strategy

I tested from the bottom up, and each layer has a job the others can't do cheaply.

- **Unit and component tests** (Vitest for the API and shared code, Jest and React Native Testing
  Library for the app). Coverage is enforced in CI against targets of 80 % lines and 70 %
  branches (95 % / 90 % for the shared package); a change that drops below fails the build.
- **Database tests** run the API against a real PostgreSQL 18 in Testcontainers: RLS isolation,
  migrations, and a two-client sync simulator that interleaves offline edits, deletes and tag
  changes from two devices and checks they converge.
- **End to end:** 12 Maestro flows on an Android emulator in GitHub Actions, against a release
  build, covering first run, sign-up, airplane-mode sync, a two-device conflict, attachments,
  export, device revocation, app lock, links, search, organising and the trash.
- **Load:** a k6 test with 50 simulated devices, each pushing 100 operations a minute.
- **Security:** an OWASP ZAP API scan driven by the generated OpenAPI document, plus gitleaks
  scanning the full git history in CI.

## Results

| Measure                         | Result                                                |
| ------------------------------- | ----------------------------------------------------- |
| Mobile app coverage             | 96 % lines / 90 % branches                            |
| API coverage                    | 92 % lines / 75 % branches                            |
| Shared package coverage         | 99 % lines / 96 % branches                            |
| End-to-end                      | 12 Maestro flows passing on an Android emulator in CI |
| Load (50 devices × 100 ops/min) | Sync p95 about 220–270 ms, against an 800 ms target   |
| Security                        | OWASP ZAP API scan: no high, medium or low alerts     |
| Release                         | v1.0.1, a signed APK on GitHub Releases               |

The API deploys from `render.yaml` only after CI passes, applies its migrations on start, and an
uptime monitor keeps the free service awake. The whole stack costs nothing to run.

## What broke and what I learned

Most of the useful lessons came from bugs the higher test layers caught after the lower ones had
passed.

**A "Continue offline" button that went nowhere.** Every unit test passed, but the first E2E
flow showed that tapping it did nothing: in local mode the welcome screen was still a valid
route, so the route guards never moved the person on. Routing only really gets tested when the
whole app runs.

**Two conflicts, one banner that wouldn't go away.** Edits queued from one stale base could
produce two conflict versions on the same note. Merging resolved only the newest, so the banner
stayed after a successful merge. Now resolving a conflict settles every open conflict on that
note, on the server and on the device.

**A stale-response race in the live-query hook.** Even after that fix, the conflict flow failed
now and then. The API log showed the merge had succeeded. The cause was on the device: two writes
in quick succession started overlapping database reads, and the older read finished last and put
stale data back on screen. Now only the newest load may set state. I learned to trust server logs
as evidence and look for the race on the client.

**A NUL character that could block a device's sync.** The ZAP scan sent a NUL character to
`PATCH /v1/me` and got a 500, because PostgreSQL can't store it in text. The more serious problem
was sync: one such operation in a batch would fail every time it was retried and hold up that
device's whole outbox. REST routes now return 400, and inside a sync batch only the offending
operation is rejected.

**Two database round trips per operation.** Load testing showed the sync bookkeeping reading and
writing an idempotency receipt for every operation separately. Now each batch reads and writes
its receipts once. I also made k6 start devices at random moments, as real devices sync, and
measure one device alone as a baseline.

**The app crashing at random on Android 14.** E2E flows died on different screens each run.
The native stack traces pointed into GWP-ASan, Android's sampling memory-error detector, which
occasionally sampled a Hermes allocation and then crashed in its own backtrace code. The app now
opts out through a config plugin. When failures move around, suspect the platform.

**CI failing because GitHub couldn't download a file.** For a while every E2E run failed with
"maestro: command not found". The Maestro install script piped into bash reported success while
GitHub release downloads were timing out. CI now fetches a pinned Maestro through the GitHub API
with retries, falls back to the release link, caches it, and fails loudly if it's missing.

The common thread: each test layer found a class of bug the cheaper layers couldn't, and making
failures readable (E2E failures now appear as CI annotations with the text that was on screen)
saved more time than any single fix.

## What I would do next

Server-side export jobs, import from Obsidian and Markdown folders, an optional encrypted local
database, and an iOS build once I have the hardware. On infrastructure, moving to an always-on
host would remove the cold-start risk; the same container runs on Railway unchanged.
