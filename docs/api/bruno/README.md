# NEXUS API collection for Bruno

[Bruno](https://www.usebruno.com) is a free, open-source desktop API client that keeps
collections as plain text files in the repository. This folder is a Bruno collection with one
request for every operation in [`../openapi.json`](../openapi.json), grouped in folders by tag
(`auth`, `notes`, `sync`, …).

## Regenerate

The collection is generated; don't edit the `.bru` files by hand. After the OpenAPI document
changes (`pnpm --filter @nexus/api openapi`), run from the repository root:

```bash
node scripts/openapi-to-bruno.mjs
```

The script needs no dependencies. It rewrites everything in this folder except this README.

## Use it

1. In Bruno, **Open Collection** and pick this folder (`docs/api/bruno`).
2. Choose an environment in the top-right corner:
   - **local**: `http://localhost:4000`, the API from `pnpm --filter @nexus/api dev`
   - **hosted**: `https://nexus-api-hv8l.onrender.com`, the Render free service (the first
     request after an idle spell can take about a minute while it wakes)
3. Open the environment's settings and set the secret `password`. Locally the seeded user is
   `demo@nexus.example` with `DEMO_PASSWORD` from `apps/api/.env`. Secrets stay on your machine;
   Bruno never writes their values into the collection files.
4. Run **auth → Sign in this device**. Its post-response script stores `accessToken` and
   `refreshToken` in the environment, and every protected request sends
   `Authorization: Bearer {{accessToken}}`.
5. Access tokens last 15 minutes. Run **auth → Rotate the refresh token** for a new pair; sending
   an old refresh token again counts as reuse and signs the device out.

## About the examples

- Request bodies hold the required fields of each schema (every field for partial updates such as
  `PATCH /v1/me`), with readable example values.
- Ids in bodies and path parameters are placeholder UUIDv7 values
  (`01900000-0000-7000-8000-000000000001`). Replace them with real ids from earlier responses,
  for example from **notes → List notes**.
- `deviceId` comes from the environment; the API accepts only UUIDv7 device ids.
- Optional query parameters are listed but disabled; tick one to send it.
- Edits and deletes need the note's current `baseRev`; a stale value produces a conflict, as it
  would from a second device.
