# CRAVE build progress

Each phase lists what was actually built, how it was verified, and what is incomplete. Nothing here should be read as production-ready unless it explicitly says so.

## Phase 1 — Project setup, database, authentication, navigation

### Built
- **Monorepo** (npm workspaces): `apps/mobile`, `apps/web`, `services/api`, `packages/core`.
- **Database schema** (`supabase/migrations`, 9 migrations): countries/cities (multi-city ready), profiles, roles, restaurants, locations, opening hours and closures, verification, certifications, menus, items, option groups/options, creators, videos, video↔menu-item links, creator permissions, follows, likes, comments, saved meals ("Cravings"), video stats, interaction/swipe/search events, explicit taste preferences, learned feature affinities, recommendation scores and impressions, baskets, orders, order items, order status events, payments, refunds, disputes, payouts, webhook log, creator attribution and commissions, notifications, push tokens, consent log, deletion requests, content reports, appeals, fraud flags, support tickets, platform settings, audit log.
- **Security in the database**: RLS enabled on every table (verified by test); protection triggers stop users self-verifying restaurants, changing commission, self-publishing videos or self-approving menu tags; order financial fields are immutable; order status changes follow a state machine enforced in SQL.
- **RPC functions**: `reset_taste_profile`, `request_account_deletion`, `restaurant_update_order_status`, `set_menu_item_availability`, `set_location_accepting_orders`, `admin_decide_verification`, `admin_set_commission`, `admin_moderate_video`, `location_is_open` (timezone- and overnight-aware), `menu_item_orderable`.
- **Seed**: 9 fictional Brisbane restaurants (one unverified), 21 menu items, customisations, 16 videos with approved menu links.
- **API** (`services/api`): Hono server with security headers, CORS allow-list, body limit, bearer-token auth verified against Supabase Auth, error handling that hides internals, `GET /health`, `GET /v1/me`.
- **Mobile**: Expo Router app with auth-guarded route groups, sign-in, sign-up (with explicit privacy choices recorded server-side), five tabs (For You, Discover, Create, Orders, Profile), Privacy & personalisation screen with working consent toggles, **Reset My Taste Profile**, and account deletion request. Sessions stored in Keychain/Keystore via a chunked SecureStore adapter.
- **Web**: Next.js dashboard shell with Supabase cookie sessions, sign-in via server action (open-redirect safe), server-side gating for `/restaurant` (membership) and `/admin` (admin role), admin overview counts.

### Tested
- `npm run test:db`: 24 database tests (RLS on every table, sign-up trigger and consent capture, restaurant onboarding protections, admin verification/commission audit, video moderation, menu-tag approval, event isolation and idempotency, order immutability and state machine via merchant RPC, Reset My Taste Profile, deletion request, overnight opening hours, orderability rules, staff permissions, storage folder isolation, and a check that the SQL state machine matches `@crave/core`).
- `packages/core` and `services/api` unit tests; TypeScript checks for all workspaces.
- Mobile JavaScript bundle compiles for Android with `expo export`; web dashboard compiles with `next build`.

### Not yet verified
- Not yet run against a live Supabase project (no Docker in the build environment). The SQL was tested on plain PostgreSQL 16 with a small Supabase compatibility shim (`supabase/tests/supabase_shim.sql`).
- The mobile app has not been run on a physical device or simulator in this environment.

### Limitations / production notes
- Terms of Service and Privacy Policy are placeholders; policy version is `2026-11-draft`.
- Age gate is a self-declaration (16+). Legal review needed on minimum age for accounts vs. purchases.
- Account deletion records the request and hides the profile; the worker that deletes the auth user is not built yet.
- No rate limiting yet (planned at the API gateway / hosting layer).

## Phase 2 — Vertical video feed and Smart Swipe

### Built
- **Feed retrieval** (`feed_candidates()` SQL function): one row per published video with its approved menu item, nearest location of a *verified* restaurant within the service radius, halal certification status, and server-computed orderability (item available, location open and accepting orders, pickup enabled). Unverified restaurants and out-of-area content never appear.
- **API**: `GET /v1/feed` (location-aware, excludes videos already shown this session, returns price, orderability reason and viewer state), `POST /v1/events` (batched, validated, idempotent by client event id), `GET /v1/saved` (Cravings / saved meals).
- **Consent-aware event ingestion**: with personalisation consent, swipes and viewing events are stored per user; without it, only anonymous aggregate counters are updated and explicit features (Cravings, likes, saves) still work. Client timestamps are clamped. Changing your mind (left after right) removes the meal from Cravings and corrects counters.
- **Smart Swipe rules in `@crave/core`** (unit-tested): horizontal-dominance and distance/velocity thresholds so vertical scrolling and short touches never register as preferences; `WatchSession` emits one impression per video per session, watch time and completion on exit, treats quick skips as a weak signal (not a dislike), ignores pass-through revisits, counts genuine re-watches as replays, and de-duplicates repeated swipes.
- **Mobile feed**: full-screen paged vertical feed (expo-video) that plays only the visible video, preloads the next and previous, pauses off-screen / on tab change / in background, with caching enabled; tap to pause; drag left/right with live "CRAVE IT" / "NOT FOR ME" labels, haptics and a confirmation stamp; left swipe advances to the next video; action rail (Crave it, Not for me, Like, Save, Share) placed outside the gesture area so swipes never steal taps; price, dietary labels, halal certification, distance and sponsorship disclosure; large order button showing why a meal is not orderable. Every gesture has an equivalent accessibility action and button; visible next/previous controls appear when a screen reader is on.
- Events are batched on device (flush every 8 s, at 20 events, and on backgrounding) with bounded memory and retry limits.
- **Your Cravings** screen listing right-swiped meals with current price and availability.

### Tested
- Core: 25 unit tests (swipe thresholds incl. diagonal/flick/reversal cases, watch session rules, event buffer batching/retry/caps, money, order state machine).
- API: 19 tests (event planner consent rules, change of mind, cross-batch counters, timestamp clamping, batch validation and size limits, feed orderability reasons, session exclusion, auth).
- Database: 26 tests including `feed_candidates` service-area filtering, halal flag, approved-link selection, unavailable items, and backend-only stats updates.
- Visual check: the app was exported for web in demo mode and driven with Playwright at phone size — Crave it button, left-drag gesture (stamp + advance to next video) and layout verified by screenshot. This caught and fixed a release-animation bug that briefly showed the wrong swipe label.

### Not yet verified / limitations
- Not run on a physical iOS/Android device in this environment; video playback, haptics and native gesture feel need on-device testing. The demo clips are not food footage.
- Ordering buttons are intentionally disabled until Phase 5.
- Comments UI is not built yet (schema exists).
- Streaming uses progressive MP4 from storage; HLS/adaptive bitrate needs a streaming provider before scale.
