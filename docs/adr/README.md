# Architecture Decision Records

Short records of the main design decisions in NEXUS, one per decision. Each comes from a
"Design decision" in the technical design document (TDD) and notes where the built system
differs from the plan. Where the two disagree, the repository is the current truth.

| ADR                                          | Decision                                                     | Status                          |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| [0001](0001-offline-first-local-database.md) | Offline-first, with SQLite on the device as the working copy | Accepted                        |
| [0002](0002-drizzle-over-prisma.md)          | Drizzle ORM rather than Prisma                               | Accepted                        |
| [0003](0003-neon-over-supabase.md)           | Neon for PostgreSQL rather than Supabase                     | Accepted                        |
| [0004](0004-full-snapshot-versions.md)       | Store note versions as full snapshots                        | Accepted                        |
| [0005](0005-server-authority-no-crdt.md)     | Server authority with revision checks and conflict copies    | Accepted                        |
| [0006](0006-drizzle-kit-sql-migrations.md)   | Drizzle Kit SQL migrations with hand-written SQL appended    | Accepted                        |
| [0007](0007-pg-boss-over-bullmq.md)          | pg-boss for background jobs rather than BullMQ               | Accepted                        |
| [0008](0008-two-client-sync-simulator.md)    | Test sync with a deterministic two-client simulator          | Accepted (server-side form)     |
| [0009](0009-neon-free-tier-provisioning.md)  | Provision the database on Neon's free plan                   | Accepted                        |
| [0010](0010-api-hosting.md)                  | Host the API on Railway Hobby                                | Superseded in practice (Render) |

## Format

Each record has a status, the context that forced a choice, the decision, and its consequences,
good and bad. To change a decision, add a new record that supersedes the old one rather than
rewriting history.
