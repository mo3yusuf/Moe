# CRAVE

**Watch it. Crave it. Order it.**

CRAVE is a mobile food-discovery and ordering platform: a full-screen vertical food video feed, a left/right "Smart Swipe" preference system, a personalised recommendation engine and (in progress) direct pickup ordering from Brisbane restaurants.

> **Status: early MVP, Phases 1–3 built.** See [docs/ROADMAP.md](docs/ROADMAP.md) for what works, what has been tested and what is still outstanding. Ordering, payments, uploads and the web dashboards are **not built yet**. All restaurants, people and videos in the repository are **fictional demo data**.

## Repository layout

```
apps/
  mobile/      Expo (React Native + TypeScript) app for iOS and Android
  api/         CRAVE backend service (Node + Hono): feed ranking, events, taste profiles
packages/
  core/        Framework-free domain logic shared by app and API (pricing, GST,
               opening hours, order lifecycle, swipe classification, recommender)
supabase/
  migrations/  PostgreSQL schema, triggers and row-level security
  seed.sql     GENERATED demo data (scripts/generate-seed.mjs)
  tests/       Local shim so migrations/RLS can be tested on plain Postgres
scripts/       Seed generator, local DB reset
docs/          Architecture, roadmap, recommendation engine, legal/compliance flags
```

## Prerequisites

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 22 LTS | everything |
| PostgreSQL client + server | 15+ | automated DB/RLS tests (`psql` must be on PATH) |
| Supabase CLI + Docker | latest | full local stack with Auth & Storage (optional for tests) |
| Expo Go or a dev build | SDK 58 | running the app on a phone |

## Quick start

```bash
npm install                       # installs all workspaces
npm test -w @crave/core           # 52 unit tests, no services needed
```

### Option A — full local stack with Supabase (recommended)

```bash
supabase start                    # starts Postgres, Auth, Storage; applies migrations + seed
supabase status                   # copy API URL, anon key, JWT secret, DB URL

cp apps/api/.env.example apps/api/.env          # fill DATABASE_URL, SUPABASE_URL, SUPABASE_JWT_SECRET
npm run api                                     # http://localhost:8787

cp apps/mobile/.env.example apps/mobile/.env.local   # fill EXPO_PUBLIC_SUPABASE_URL / ANON_KEY / API_URL
npm run mobile                                  # press i (iOS sim), a (Android), or scan QR in Expo Go
```

On a physical phone, `EXPO_PUBLIC_API_URL` must use your computer's LAN IP (not `localhost`).

> Not yet verified in this repository: `supabase start` itself (the CLI/Docker weren't available in the build environment). The migrations and seed were verified on PostgreSQL 16 through the shim in `supabase/tests/local-shim.sql`. If `supabase start` reports an error, please share it.

### Option B — plain PostgreSQL (what the automated tests use)

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/crave_test scripts/db-local-reset.sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/crave_test \
SUPABASE_JWT_SECRET=any-local-secret-of-at-least-32-characters \
  npm run api
```

The feed, Discover, restaurant and meal screens work signed-out against this API. Accounts, comments and Cravings need Supabase Auth (Option A).

### Demo accounts (local only)

All seeded accounts use the password `CraveDemo!2026`.

| Email | Role |
| --- | --- |
| `sam@demo.crave.local` | customer (follows a creator and a restaurant) |
| `alex@demo.crave.local` | customer |
| `mia@demo.crave.local`, `jordan@demo.crave.local` | creators |
| `owner.ember@demo.crave.local` (and `owner.kaizen`, `owner.nonna`, …) | restaurant owners |
| `admin@demo.crave.local` | administrator |

Demo videos are public sample clips (not food footage) used only as playback placeholders, and every demo video is badged **DEMO CONTENT** in the app.

## Tests

```bash
npm test -w @crave/core     # unit: money/GST, pricing, hours, order lifecycle, swipes, validation, recommender
npm test -w @crave/api      # resets crave_test DB, then RLS + API integration tests on real Postgres
npm run typecheck           # all workspaces
```

CI runs all of the above (`.github/workflows/ci.yml`).

## External services you will need

| Service | Purpose | When |
| --- | --- | --- |
| Supabase (project in **Sydney, ap-southeast-2**) | Postgres, Auth, Storage | now |
| Hosting for `apps/api` (e.g. Fly.io / Render / AWS in Sydney) | backend service | before pilot |
| Stripe (Australian account) with **Connect** | payments, payouts, refunds | Phase 5/7 (requires Stripe approval) |
| Apple Developer Program + Google Play Console | app store releases | before launch |
| Expo / EAS | builds, submissions, OTA updates | before launch |
| Video streaming (Mux or Cloudflare Stream) | adaptive streaming at scale | before scale-up |
| Delivery provider (e.g. Uber Direct, DoorDash Drive) | delivery | Phase 8 |
| Email/SMS provider, push notifications (Expo Push / FCM / APNs) | notifications | Phase 5+ |

Secrets live only in environment variables (`.env*` files are git-ignored). The mobile app only receives public values (`EXPO_PUBLIC_*`), and the database is protected by row-level security.

## Documentation

- [Architecture & technical decisions](docs/ARCHITECTURE.md)
- [Roadmap & phase status](docs/ROADMAP.md)
- [Recommendation engine](docs/RECOMMENDATIONS.md)
- [Legal, privacy & security items requiring professional review](docs/LEGAL_AND_COMPLIANCE.md)
