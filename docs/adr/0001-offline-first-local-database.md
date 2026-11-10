# ADR 0001: Offline-first, with SQLite on the device as the working copy

- **Status:** Accepted
- **Source:** TDD design decision D-01

## Context

NEXUS is for people who write on trains, planes and client sites. A notes app that waits on the
network for every screen fails exactly where they need it. The app also has to sync between a
person's devices, so "offline mode" can't be an afterthought bolted on to an online app.

## Decision

Every feature is designed first against SQLite (with FTS5) on the device. Each local write updates
SQLite and queues an operation in an outbox; sync is a separate layer that pushes those
operations and pulls the server's change feed. A feature that can't be expressed as "local data
plus an operation" is deferred.

## Consequences

- Editing, search, backlinks, the graph, history and export work with no connection, and the
  **Continue offline** path needs no account at all.
- Screens read from the local database only, so the UI never waits on the network for data.
- The cost is a second data model to keep in step with the server's, a sync engine, and conflict
  handling ([ADR 0005](0005-server-authority-no-crdt.md)).
- Export runs on the device (Markdown zip or JSON). The API has export endpoints, but
  server-side export jobs in the app are still on the roadmap.
