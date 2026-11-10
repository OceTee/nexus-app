# ADR 0007: pg-boss for background jobs rather than BullMQ

- **Status:** Accepted
- **Source:** TDD design decision D-07

## Context

The API needs a few scheduled maintenance jobs (purging deleted accounts, pruning versions and
tokens, sweeping orphaned attachments, compacting the change feed, backups) plus queued work
such as sending email and push nudges. The volume is small.

## Decision

Use pg-boss, which keeps its queue in a `pgboss` schema in the same PostgreSQL database. It gives
retries, cron schedules and safe concurrent workers through `SKIP LOCKED`. BullMQ would need a
Redis instance, which costs money or another free account on every host considered.

## Consequences

- One container runs both the API and the workers (`ROLE=all`), so there is one thing to deploy.
- There is no extra service to run, secure or monitor; job state sits in PostgreSQL and can be
  inspected with plain SQL.
- Workers need a direct (unpooled) connection, and scheduled jobs run as a maintenance role that
  bypasses RLS; both are separate connection strings.
- On Render's free plan the process sleeps when idle, which would stop the schedules; an uptime
  monitor pinging `/healthz` every 5 minutes keeps it awake ([ADR 0010](0010-api-hosting.md)).
