# ADR 0004: Store note versions as full snapshots

- **Status:** Accepted
- **Source:** TDD design decision D-04

## Context

Version history answers "what did this note say last week?" and powers one-tap restore. The same
store holds the losing side of a sync conflict, which the merge screen shows next to the server's
copy. Versions could be full copies or diffs against the previous version.

## Decision

Every accepted note change writes a full snapshot (title and Markdown body) to `note_versions`.
Retention is the newest 50 versions per note and nothing older than 90 days, whichever is
stricter, applied by the nightly `versions.prune` job. Conflict versions are kept until resolved,
then for 90 more days. The device keeps its last 10 versions per note for offline restore.

## Consequences

- Restore and the conflict view are a single row read; there is no chain of diffs to replay or
  to corrupt.
- Bodies are capped at 200,000 characters, so the worst case is about 10 MB of history per note;
  typical notes are under 5 KB, so real usage is far below that.
- Storage use is higher than a diff store would need. If it ever matters, old versions can be
  compressed or thinned without changing the API.
