# CRAVE

**Watch it. Crave it. Order it.**

CRAVE is a social food-ordering platform: short vertical food videos from restaurants and creators, Smart Swipe preference signals, personalised recommendations, and direct pickup ordering from the video. The launch market is Brisbane, QLD.

> **Status: early MVP under active development.** See [`docs/PROGRESS.md`](docs/PROGRESS.md) for what is built, what is tested, and what is still placeholder, phase by phase. Demo data is fictional. Payments are not live.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/mobile` | iOS and Android app (Expo SDK 58, React Native, TypeScript, Expo Router) |
| `apps/web` | Restaurant and admin dashboards (Next.js 16, App Router) |
| `services/api` | Backend API (Hono on Node): feed ranking, events, ordering, payments, webhooks |
| `packages/core` | Framework-free domain logic shared by all three: money/GST, order state machine, swipe classification, recommendation engine |
| `supabase/migrations` | PostgreSQL schema, row-level security, triggers, RPC functions |
| `supabase/seed.sql` | Fictional Brisbane demo restaurants, menus and videos |
| `supabase/tests` | Database tests run against a throwaway PostgreSQL cluster |
| `docs/` | Architecture, progress log, launch and compliance notes |

## Prerequisites

- Node.js 20+ (developed on 22) and npm 10+
- For the local database: Docker + the Supabase CLI (`npx supabase`), **or** a hosted Supabase project
- For database tests only: PostgreSQL 15+ server binaries (`initdb`, `pg_ctl`) — no Docker needed
- For the mobile app: Expo Go is not enough once native modules are used; use a development build (`npx expo run:ios|android` or EAS Build)

## Quick start (local)

```bash
npm install

# 1. Database (Docker required)
npx supabase start            # prints API URL, anon key and service role key
npx supabase db reset         # applies supabase/migrations + supabase/seed.sql
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<service key> \
  node scripts/create-demo-accounts.mjs   # loginable demo accounts (local/staging only)

# 2. API
cp services/api/.env.example services/api/.env   # fill in keys from `supabase start`; PAYMENTS_MODE=simulated for local testing
npm run dev:api                                   # http://localhost:8787/health

# 3. Web dashboards
cp apps/web/.env.example apps/web/.env.local
npm run dev:web                                   # http://localhost:3000

# 4. Mobile app
cp apps/mobile/.env.example apps/mobile/.env
npm run dev:mobile                                # then press i / a, or scan with a dev build
```

**Without any backend**, the mobile app runs in a clearly labelled *demo mode* on bundled sample data (no sign-in, ordering disabled). This is for UI review only.

## Payments (Stripe Connect)

- Local development: `PAYMENTS_MODE=simulated` gives a clearly labelled test payment step (refused in production).
- Stripe test mode: set `PAYMENTS_MODE=stripe`, `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRETS=whsec_…` (API) and `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…` (app), then forward webhooks with `stripe listen --forward-to localhost:8787/webhooks/stripe` (add `--forward-connect-to` for Connect events). Card payments require a development build (`npx expo run:ios|android`), not Expo Go.
- See `docs/LAUNCH.md` for live setup and `docs/SECURITY.md` for the security review.

## Tests

```bash
npm test          # unit tests: packages/core, services/api, apps/mobile logic
npm run test:db   # database: RLS, triggers, state machine, privacy functions (needs Postgres binaries)
npm run typecheck # TypeScript across all workspaces
```

## External services and accounts

| Service | Used for | Needed from |
| --- | --- | --- |
| [Supabase](https://supabase.com) | Postgres, Auth, Storage | Phase 1 |
| [Expo / EAS](https://expo.dev) | Mobile builds, OTA updates, store submission | Phase 1 (builds) |
| [Stripe](https://stripe.com/au) + Stripe Connect | Card payments, marketplace payouts, refunds, disputes | Phase 7 (requires Stripe platform approval) |
| Apple Developer Program | iOS App Store distribution | Pilot |
| Google Play Console | Android distribution | Pilot |
| Video streaming provider (e.g. Mux, Cloudflare Stream) | Transcoding, HLS adaptive streaming | Before scale; Supabase Storage is used initially |
| Push notifications (Expo Push / APNs / FCM) | Order status updates | Phase 5 |
| Delivery partner (e.g. DoorDash Drive, Uber Direct) | Delivery fulfilment | Phase 8 |
| Error monitoring (e.g. Sentry) | Crash and error reporting | Pilot |

## Security notes

- The Supabase **service role key** is only ever used by `services/api` (server-side). Mobile and web clients use the anon key, and all their data access is constrained by row-level security.
- Clients never submit prices or totals; the API recomputes every amount from the database.
- See `docs/PROGRESS.md` for known limitations before any production use.
