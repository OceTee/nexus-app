# Deployment (Phase 13)

How to put the NEXUS API online and publish the Android app, using free plans. The TDD's
default host is Railway Hobby ($5 a month); this guide uses Render's free plan instead, and the
same container image runs on either (see [Moving to Railway](#moving-to-railway)).

| Piece                   | Service (free plan)                                              | Used for                                                     |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| API and workers         | [Render](https://render.com) web service, Docker                 | `apps/api/Dockerfile`, configured by `render.yaml`           |
| Database                | [Neon](https://neon.tech) PostgreSQL                             | `main` branch for production, `staging` branch for staging   |
| Attachments and backups | [Backblaze B2](https://www.backblaze.com/cloud-storage) (S3 API) | or Cloudflare R2, which needs a payment method on file       |
| Email                   | [Resend](https://resend.com)                                     | verification, reset and security emails                      |
| Keep-awake and uptime   | [UptimeRobot](https://uptimerobot.com)                           | pings `/healthz` every 5 minutes                             |
| Android app             | GitHub Actions + GitHub Releases                                 | `.github/workflows/release.yml` builds and publishes the APK |

Nothing here needs a credit card except Cloudflare R2.

## Free-plan limits worth knowing

- **Render free** sleeps after 15 idle minutes and takes about a minute to wake. The uptime
  monitor keeps it awake; 750 free hours a month cover one service running all month. Builds
  are slower than on paid plans.
- **Neon free**: 0.5 GB of storage per project, compute that suspends when idle (the first
  query after a pause takes a moment).
- **Backblaze B2**: 10 GB stored free; downloads free up to 3× the stored amount a day.
- **Resend free**: 3,000 emails a month, 100 a day. Until you verify a domain you own, Resend
  only delivers to your own sign-up address, so other people can't confirm their accounts.

## 1. Database (Neon)

1. Create a project named `nexus` in **AWS Frankfurt (eu-central-1)**, next to Render's
   Frankfurt region in `render.yaml`. Postgres version 18.
2. In **Branches**, create `staging` from `main` (for a staging deployment later).
3. In the **SQL Editor** on `main`, create the API's login role with a strong password (a
   password manager can generate one). The first migration grants it its rights:

   ```sql
   CREATE ROLE nexus_api LOGIN PASSWORD '<a long random password>' NOBYPASSRLS;
   ```

4. From **Connect**, copy two connection strings for `main`:
   - **Pooled**, user `nexus_api` with the password above → `DATABASE_URL`
   - **Direct** (pooling off), the owner role (`neondb_owner`) → `DATABASE_URL_DIRECT` and
     `JOBS_DATABASE_URL` (background jobs need a direct connection)

   Both end in `?sslmode=require`.

## 2. Attachment storage (Backblaze B2)

1. Create a **private** bucket, e.g. `nexus-attachments-prod`.
2. Note its **S3 endpoint** on the bucket page, e.g. `s3.eu-central-003.backblazeb2.com`; the
   region is the middle part (`eu-central-003`).
3. In **Application Keys**, add a key with read and write access to that bucket only.

These become `R2_ENDPOINT=https://s3.<region>.backblazeb2.com`, `R2_REGION=<region>`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID` (the keyID) and `R2_SECRET_ACCESS_KEY` (the applicationKey).
The variable names say R2 because Cloudflare R2 is the TDD's default; any S3-compatible store
works.

## 3. Email (Resend)

Create an API key with **sending access** → `RESEND_API_KEY`. Without a verified domain, set
`MAIL_FROM` to `NEXUS <onboarding@resend.dev>`. With a domain, verify it in Resend and use an
address on it.

## 4. API (Render)

1. In Render: **New → Blueprint**, pick the `OceTee/nexus-app` repository. Render reads
   `render.yaml` and asks for every value marked `sync: false`:

   | Variable                                    | Value                                                               |
   | ------------------------------------------- | ------------------------------------------------------------------- |
   | `DATABASE_URL`                              | Neon pooled URL (`nexus_api`)                                       |
   | `DATABASE_URL_DIRECT`, `JOBS_DATABASE_URL`  | Neon direct URL (owner)                                             |
   | `DATABASE_URL_MAINT`                        | leave empty (falls back to the jobs URL)                            |
   | `APP_URL`                                   | where links in emails point; until the web demo exists, the API URL |
   | `CORS_ORIGINS`                              | leave empty (the app doesn't need CORS)                             |
   | `RESEND_API_KEY`, `MAIL_FROM`               | from step 3                                                         |
   | `R2_*`                                      | from step 2                                                         |
   | `EXPO_ACCESS_TOKEN`, `BACKUP_AGE_RECIPIENT` | leave empty for now (push and backups stay off)                     |

   `JWT_SECRET` is generated by Render. Never commit any of these values.

2. The first deploy builds the image, applies the migrations (`MIGRATE_ON_START=true`) and
   starts the API. Render deploys a commit only after its CI checks pass
   (`autoDeployTrigger: checksPass`).
3. Check it: `https://<service>.onrender.com/readyz` returns `{"status":"ready",…}` and
   `/v1/meta` returns the API version.

## 5. Uptime monitor (UptimeRobot)

Add an **HTTP(s)** monitor for `https://<service>.onrender.com/healthz` every **5 minutes**,
with email alerts. This keeps the free service awake and covers the TDD's uptime monitor.

## 6. Android app (GitHub Releases)

1. In GitHub: **Settings → Secrets and variables → Actions → Variables**, add `API_URL` =
   `https://<service>.onrender.com`.
2. Optional, for a properly signed APK: create an upload key once and keep a backup of it and its
   passwords (a lost key can't be recovered):

   ```bash
   keytool -genkeypair -v -keystore nexus-upload.keystore -alias nexus -keyalg RSA -keysize 2048 -validity 10000
   ```

   Then add four repository **Secrets**: `ANDROID_KEYSTORE_BASE64` (the file, base64-encoded:
   `base64 -w0 nexus-upload.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
   (`nexus`) and `ANDROID_KEY_PASSWORD`. Without them the APK is debug-signed, which installs
   fine but can't go on the Play Store.

3. Release: tag and push, and the workflow publishes `nexus-<version>.apk` with its SHA-256 on
   the GitHub Release.

   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```

   **Actions → Release → Run workflow** builds the APK without publishing (artifact only).

## Rollback

- **API**: in Render, **Events → Rollback** to an earlier deploy. Migrations only add
  (TDD Section E), so the previous image runs on the newer schema.
- **Database**: Neon keeps a restore window on the free plan; **Branches → Restore** brings
  `main` back to a point in time. Practise on `staging` first.
- **App**: the previous APK stays on its GitHub Release.

## Moving to Railway

Create a service from the repo with the Dockerfile `apps/api/Dockerfile` (build context: the repo
root), set the same variables, and either keep `MIGRATE_ON_START=true` or run
`node dist/migrate.js` as the pre-deploy command. Health check path: `/readyz`.

## Not covered yet

- **Push notifications** need an Expo project (`EXPO_ACCESS_TOKEN`, EAS project id) and
  Firebase Cloud Messaging credentials for Android. The app works fully without push.
- **Encrypted nightly backups** need an [age](https://age-encryption.org) key pair: the public
  key goes in `BACKUP_AGE_RECIPIENT`; keep the private key offline.
- **iOS** builds need a Mac or EAS with an Apple developer account.
