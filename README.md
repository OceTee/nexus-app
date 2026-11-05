<p align="center">
  <strong>NEXUS</strong><br>
  <em>Your thinking, connected.</em>
</p>

# NEXUS

NEXUS is a personal knowledge management app for Android and iOS. It lets one person capture, organise, connect and find their notes across all of their devices, and it works fully without an internet connection.

The phone is where the work happens, not the server. Every note, collection, tag, link and attachment reference lives in a database on the device, so writing, searching, following links and exploring the knowledge graph never wait on the network. Syncing between devices runs quietly in the background whenever a connection is available.

## What it is meant to be

NEXUS is built so that notes behave like a second memory rather than a filing cabinet: quick to capture, always available, and quietly connected. Three principles shape it:

1. **The device comes first; the server keeps the record.** The app never blocks you on the network. The server's job is to put changes in order, spot conflicts and keep a safe history.
2. **Structure comes from writing.** Links, backlinks and the graph are built from what you type. Collections and tags are there when you want them, never required.
3. **You own your notes.** Exporting everything, managing your devices, seeing version history and deleting your account are core features, not support requests.

## The problems it solves

People who think in writing collect notes across apps and devices, then lose the connections between them. NEXUS answers each common pain point with a specific feature:

| Problem                                               | How NEXUS handles it                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| Edits made offline get lost or duplicated             | Every change is queued on the device and synced safely later          |
| Search stops working without a connection             | Full-text search runs on the device                                   |
| Links between notes are invisible                     | `[[wiki-links]]`, backlinks and an interactive knowledge graph        |
| Two devices disagree and one version silently wins    | Conflicts are detected and the other version is kept for you to merge |
| "What did this note say last week?" can't be answered | Version history with one-tap restore                                  |
| Getting your notes out of the app is hard             | One-step export of everything as Markdown or JSON                     |
| Slow, heavy mobile editors                            | A native app reading from a local database                            |

## What it does

- **Write in Markdown**: edit, preview and reading modes; pin important notes; a trash with a 30-day grace period.
- **Organise**: nested collections (up to six levels deep) and tags you can rename and merge.
- **Connect ideas**: type `[[` to link to another note, see every backlink with its context, and have links follow a note when it is renamed.
- **Explore the knowledge graph**: an interactive map of how your notes connect, with filters and quick previews.
- **Search instantly, even offline**: ranked full-text search with filters, entirely on the device.
- **Sync across devices**: changes reconcile in the background; a clear conflict screen lets you merge when two devices edited the same note.
- **Go back in time**: browse earlier versions of a note and restore any of them.
- **Attach files**: images and PDFs, viewable inside the app and cached for offline use.
- **Stay in control**: export everything, see and sign out any device, check sync status, lock the app with biometrics, and delete your account with a 30-day grace period.
- **Light and dark themes**, built to WCAG 2.2 AA accessibility standards.

## Who it is for

NEXUS is for individuals who write and think across more than one device and who want to own their notes. It is designed around three kinds of user:

- **Researchers and students**, such as a postgraduate who keeps one note per paper, links papers to concepts and needs to find "which paper said X" on a train with no signal.
- **Consultants and analysts**, such as someone travelling between client sites who captures meeting notes and whiteboard photos on flights, then exports a client's notes when the engagement ends.
- **Software engineers**, such as someone keeping runbooks and code snippets in Markdown, linking them to incident notes and checking version history after a bad edit.

NEXUS is a personal tool. Team workspaces, sharing and real-time collaboration are not part of it.

## Tech stack

The whole project is written in TypeScript and organised as a pnpm and Turborepo monorepo.

**Mobile app**

- **Expo SDK 58** (React Native 0.88, React 19) with **Expo Router** for navigation
- **expo-sqlite** with **FTS5** full-text search as the on-device database
- **d3-force** and **React Native Skia** for the knowledge graph
- **Zustand** for app state and **TanStack Query** for server data
- **React Hook Form** and **Zod** for forms and validation
- **expo-secure-store** for credentials and biometric app lock

**Backend**

- **Node.js 24** and **Express 5**
- **PostgreSQL 18** on **Neon**, accessed through **Drizzle ORM** with row-level security
- **Cloudflare R2** for attachments, using presigned uploads
- **pg-boss** for background jobs, stored in Postgres
- Its own authentication: **Argon2id** password hashing and **JWT** access tokens with rotating refresh tokens
- **pino** logging and **helmet** security headers
- **Expo push notifications** and **Resend** for email

**Shared code**

- `@nexus/shared`: Zod schemas, Markdown helpers and merge rules used by both the app and the API
- `@nexus/ui`: design tokens and UI building blocks

**Quality and delivery**

- **Vitest**, **Jest**, **React Native Testing Library**, **Supertest** and **Testcontainers** for tests; **Maestro** for end-to-end tests; **k6** for load tests
- **ESLint**, **Prettier**, **commitlint** and **gitleaks** in **GitHub Actions**
- **EAS Build** and **EAS Update** for app builds and over-the-air updates; **Railway** for hosting the API; **Sentry** for error monitoring

## Development

Setup instructions, scripts and Windows notes are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Licence

MIT for code. The NEXUS name and brand assets are reserved.
