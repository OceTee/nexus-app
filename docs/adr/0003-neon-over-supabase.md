# ADR 0003: Neon for PostgreSQL rather than Supabase

- **Status:** Accepted
- **Source:** TDD design decision D-03 (provisioning details in
  [ADR 0009](0009-neon-free-tier-provisioning.md))

## Context

The API needs a hosted PostgreSQL 18 database on a free plan. The design already has its own
authentication (Argon2id and JWTs) and S3-compatible object storage, so a platform's bundled
auth, storage and dashboards add little.

## Decision

Use Neon. It is plain PostgreSQL with row-level security available to our own roles, a pooled
connection string for the API and a direct one for migrations and background jobs, and branching
(`main` for production, `staging` for trials and restores).

## Consequences

- Nothing in the API is tied to Neon; locally and in CI the same code runs against PostgreSQL 18
  in Docker (Testcontainers for the database tests).
- Neon's free compute suspends when idle, so the first query after a pause is slower. That is
  acceptable for a portfolio demo and is documented.
- The TDD planned a Neon branch per pull request. In practice CI uses throwaway Docker
  databases, which are faster and need no secrets in pull requests.
- Storage is Backblaze B2 rather than the TDD's Cloudflare R2 (R2 needs a payment method on
  file); the API talks to any S3-compatible store, so this didn't affect the database choice.
