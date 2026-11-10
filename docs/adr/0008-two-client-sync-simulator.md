# ADR 0008: Test sync with a deterministic two-client simulator

- **Status:** Accepted, implemented as a server-side simulator
- **Source:** TDD design decision D-08

## Context

Sync bugs show up when two devices interleave edits, go offline and come back in an awkward
order. Reproducing that on two phones is slow and not repeatable, and emulator E2E tests are too
slow to cover many orderings.

## Decision

Write a small simulated client with its own notes, tag memberships, outbox and cursor, and run
two of them against the real API and PostgreSQL in a test container. Scenario tests interleave
edits, deletes and tag changes, take clients offline and back, and assert that both converge.

## Consequences

- Conflict handling, idempotent retries, set-merge rules and cursor expiry are covered at
  unit-test speed, and each scenario fails the same way every time.
- The TDD described running two copies of the mobile data layer. I implemented a leaner client
  in the API tests (`apps/api/test/helpers/syncClient.ts`) and covered the app's real sync
  engine separately with Jest; a Maestro flow then checks a real conflict and merge on an
  emulator.
- The simulator can drift from the app's behaviour. The shared Zod schemas and their contract
  snapshot limit that drift, since both sides validate the same operation types.
