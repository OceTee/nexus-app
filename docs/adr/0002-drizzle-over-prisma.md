# ADR 0002: Drizzle ORM rather than Prisma

- **Status:** Accepted
- **Source:** TDD design decision D-02

## Context

The sync endpoint is a sequence of carefully ordered SQL statements in one transaction: set the
row-level security (RLS) context, lock the target rows, check revisions, write versions and
change-feed rows. The ORM has to make that easy to write and easy to read, and RLS policies
should live next to the tables they protect.

## Decision

Use Drizzle ORM. Its API stays close to SQL, it declares RLS policies in the schema
(`pgPolicy`), and a small `withUser()` helper opens a transaction and runs
`set_config('app.user_id', …, true)` so every query in it is scoped to one user. Prisma 7 would
need a client extension to set the RLS context per transaction, with the policies kept as raw
SQL elsewhere.

## Consequences

- The sync service reads like the SQL it runs, which made row locking (`SELECT … FOR UPDATE`)
  and batching straightforward to reason about.
- Policies, tables and indexes are in one TypeScript schema; there is one source of truth.
- Drizzle has a smaller community than Prisma and fewer ready-made answers, and some database
  features (triggers, functions, grants) still need hand-written SQL
  ([ADR 0006](0006-drizzle-kit-sql-migrations.md)).
