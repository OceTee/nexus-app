# ADR 0009: Provision the database on Neon's free plan

- **Status:** Accepted
- **Source:** TDD design decision D-09 (restates [ADR 0003](0003-neon-over-supabase.md) with
  provisioning details)

## Context

The demo has to stay reachable between interviews without anyone touching it, and it has to cost
nothing. Supabase's free plan pauses a project after 7 days of low activity, which would break
the demo at the worst moment. Neon's free compute suspends after a few idle minutes but wakes on
the next query.

## Decision

One Neon project, `nexus`, in AWS Frankfurt next to the API's Render region, on PostgreSQL 18.
The `main` branch is production and `staging` is for trials and practising restores. The API
connects through the pooled endpoint as `nexus_api`, a role without `BYPASSRLS`; migrations and
pg-boss use the direct endpoint as the owner.

## Consequences

- No credit card, and the database never pauses for good.
- The first query after an idle spell is slower; the uptime monitor that keeps the API awake
  also keeps this rare.
- The free plan's storage is small (the deployment guide records 0.5 GB per project, lower than
  the TDD's figure), which is plenty for a demo but would need a paid plan for real users.
- The free plan's point-in-time restore window is short. The nightly encrypted `pg_dump` to
  object storage is built but stays off until an age key is configured.
