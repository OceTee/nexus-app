# ADR 0010: Host the API on Railway Hobby

- **Status:** Superseded in practice by Render's free plan (see "What happened")
- **Source:** TDD design decision D-10

## Context

The API and its pg-boss workers run as one long-lived container. Vercel has no resident process
for the workers, Fly.io has no standing free tier, and Render's free plan sleeps after 15 idle
minutes and takes about a minute to wake. The TDD chose Railway Hobby (about $5 a month) for
always-on service and GitHub-linked deploys.

## Decision (TDD)

Railway Hobby as the primary host, with Fly.io as the cheapest always-on alternative.

## What happened

The project rule became "free plans only", so the API runs on **Render's free plan** from
`render.yaml`, in Frankfurt, deploying only commits whose CI checks pass. UptimeRobot pings
`/healthz` every 5 minutes, which keeps the service awake (750 free hours cover one service all
month) and doubles as the uptime monitor. Attachments use Backblaze B2 instead of Cloudflare R2.

## Consequences

- The whole stack costs nothing and needs no credit card.
- If the monitor stops, the first sync after a sleep is slow; the app retries in the background,
  so it delays sync but never blocks writing.
- Builds are slower than on paid plans.
- The same Docker image runs on Railway unchanged; [docs/DEPLOYMENT.md](../DEPLOYMENT.md) has the
  steps to move.
