# CRAVE architecture

## Overview

```
┌──────────────────────┐      ┌───────────────────────────┐
│  Mobile app (Expo)   │─────▶│  CRAVE API (Node, Hono)   │──┐
│  iOS · Android       │ JWT  │  feed ranking, events,    │  │ service connection
│                      │      │  orders*, payments*,      │  │ (server-side only)
│                      │      │  Stripe webhooks*         │  ▼
│                      │      └───────────────────────────┘ ┌──────────────────────┐
│                      │─────────── Supabase JS (RLS) ─────▶│ Supabase             │
└──────────────────────┘                                    │ Postgres · Auth ·    │
┌──────────────────────┐                                    │ Storage              │
│ Web dashboards*      │─────────── Supabase JS (RLS) ─────▶│                      │
│ (Next.js: merchant,  │─────────▶ CRAVE API               └──────────────────────┘
│  admin)              │
└──────────────────────┘                    * = later phase
```

### Packages

| Package | Responsibility |
| --- | --- |
| `packages/core` | Pure TypeScript domain logic with no framework dependencies: money in integer cents, GST, basket pricing/commission, opening hours by IANA timezone, orderability rules, order state machine, swipe & watch-signal classification, Australian address/ABN validation, video upload limits, and the recommendation engine. Shared by the API (authoritative) and the app (for display), so the two can't drift apart. |
| `apps/api` | Business logic that must not run on a phone: ranking feeds, ingesting interaction events, taste-profile updates, and (Phase 5+) order creation, Stripe PaymentIntents, webhooks, refunds and payouts. Verifies Supabase JWTs and uses a privileged DB connection. |
| `apps/mobile` | Expo Router app. Reads public catalogue data and the user's own rows through Supabase with RLS; calls the API for anything ranked, priced or financial. |
| `supabase/` | Schema, triggers, RLS, storage buckets, seed. |

## Key decisions

1. **Expo + React Native + TypeScript.** One codebase for iOS and Android, EAS for builds/submissions/OTA updates, `expo-video` for hardware-accelerated playback with caching.
2. **Supabase for Auth, Postgres and Storage.** Row-level security is the primary access-control layer for direct client reads/writes. Every table has RLS enabled. Guard triggers block privilege escalation (for example, a restaurant can't activate itself, a creator can't approve their own dish tag, a user can't edit follower counts).
3. **A separate API service, not only Edge Functions.** Ranking, pricing and payments need shared, well-tested TypeScript (`@crave/core`) and transactional SQL. A small Node service is easier to test (43 integration tests run against real Postgres) and to scale independently. Edge Functions remain an option for lightweight hooks.
4. **Server-authoritative money.** Prices are integer cents. Orders, payments and ledger rows have *no* client write policies. The API recomputes totals from DB prices, and only a verified Stripe webhook can move an order from `pending_payment` to `placed` (Phase 5). The DB also rejects invalid status jumps and changes to order amounts.
5. **Recommendation engine as a pure, configurable module.** Weights live in a versioned `recommendation_configs` row validated by zod. Each impression is logged with the config version, so changes can be evaluated. The ranking function is an interface (`rankFeed`) that can later be backed by a learned model without changing the app.
6. **Privacy by design.** Events store IDs and timings only (no location, device IDs or free text beyond a truncated search query). Location is coarsened to about 1 km on the device and again on the server, and never stored. Long-term learning lives in an aggregated taste profile, and raw events have a 180-day retention function. Users can turn personalisation off (nothing is recorded) or reset it.
7. **Multi-market from day one.** A `markets` table holds city, country, timezone, currency and tax rate. Restaurants belong to a market, and opening hours use IANA timezones (Brisbane has no DST, Sydney/Melbourne do, and this is handled).
8. **Delivery as a separate, disabled module.** `delivery_providers`/`delivery_jobs` tables exist, `restaurants.delivery_enabled` can't be switched on by restaurants, and pricing refuses delivery without a provider quote. No simulated drivers or tracking.
9. **Video pipeline.** Supabase Storage first (200 MB / 3 min / MP4 or MOV limits enforced in the bucket config and in validation). `videos.streaming_provider` + `playback_url` allow moving to Mux or Cloudflare Stream (HLS, adaptive bitrate, thumbnails) without schema changes. **This is recommended before scale.**

## Feed performance

- The vertical `FlatList` pages full-screen items. Only the active item and its neighbours hold a loaded `VideoPlayer` (preloads the next clip, releases distant ones), with `useCaching` for replays.
- Pages of 6 are fetched ahead (`onEndReachedThreshold=2`). The server excludes already-served videos per feed session.
- The horizontal swipe is a Gesture Handler pan with `activeOffsetX ±18` and `failOffsetY ±14`, so vertical scrolling and button taps keep working. Overlays (buttons, Order Now) sit outside the gesture area.
- Scaling path: precomputed candidate pools per market/geo-cell, Redis cache for trending, HLS streaming, and moving `video_interactions` to partitioned tables.

## Security model (summary)

| Data | Customer | Creator | Restaurant member | Admin | API (service) |
| --- | --- | --- | --- | --- | --- |
| Active restaurants/menus | read | read | read + manage own | all | all |
| Unverified restaurant | — | — | own | all | all |
| Own profile/preferences/consents | read/write | read/write | read/write | read | all |
| Taste profile & interaction logs | read own | read own | — | — | write |
| Orders | read own | read own | read own restaurant | all | write |
| Payments/ledger | read own payments | — | owner: read | all | write |
| Video → dish links | read approved | create (pending) | approve/reject own | all | all |
| Moderation reports | create, read own | create | create | resolve | all |
