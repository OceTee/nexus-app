# ADR 0005: The server is the authority; revision checks and conflict copies, no CRDT

- **Status:** Accepted
- **Source:** TDD design decision D-05

## Context

One person can edit the same note on two devices while one of them is offline. Some apps merge
text automatically with CRDTs. NEXUS is a single-user app where true concurrent edits are rare,
and the people using it care more about never losing text than about automatic merging.

## Decision

Every note carries a server revision. A device sends each edit with the revision it started from
(`baseRev`). If that matches the server, the edit becomes the next revision. If not, the server
keeps its copy untouched and stores the device's text as a conflict version; the app shows a
banner and a side-by-side screen to keep one copy or merge both. Tags and links merge as sets,
and collection moves are last-write-wins.

## Consequences

- No edit is ever silently overwritten, and the behaviour is easy to explain and to test.
- The person sometimes has to merge by hand. In practice this is rare and the screen makes it
  quick.
- Version history stays a simple list of snapshots ([ADR 0004](0004-full-snapshot-versions.md))
  instead of an operation log.
- Edge cases still needed care: two conflicts on one note must all be settled by one resolution,
  on both the server and the device.
