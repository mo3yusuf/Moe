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

## Phase 3 — Recommendation engine and taste profile

### Built
- **Rules-based ranking engine** in `@crave/core/recommend` — framework-free and behind a `Ranker` interface in the API, so an ML model can replace it later without app changes.
  - Signal weights (all configurable): right swipe +3, left swipe −2, order +5, repeat order +7, add to basket +2.5, order click +2, menu item click +1.5, save +1.5, like +1, replay +0.8, long watch +0.5, quick skip −0.3. Ordinary viewing is neutral.
  - Each signal spreads to the meal's attributes (restaurant, dish category, cuisine, tags, price level, creator, halal certification), decays with a 30-day half-life, and is squashed so no single action dominates. Affinities have a floor, so behaviour alone never excludes a food category.
  - Scoring combines learned taste (shrunk for users with little history), time-of-week habits learned from orders (e.g. Friday-evening sushi, Brisbane time), explicit favourite/disliked cuisines, spice tolerance, price fit (explicit budget or learned typical spend), smoothed popularity, freshness, distance, and orderability.
  - Hard filters: the exact video a user rejected (for 60 days), and dietary requirements the user explicitly set (matched only against restaurant declarations or verified certification; unverifiable content excluded).
  - Exploration: every 5th slot is good, orderable content from a cuisine the user hasn't expressed a view on. Diversity: no same restaurant back-to-back and no long same-cuisine runs.
  - Plain-language reasons ("Because you crave Japanese", "Your usual Japanese time", "Something different to try") shown in the feed.
- **Admin-tunable weights** via `platform_settings.ranking_weights`, merged and validated (bad values ignored, never crash the feed). Model version is recorded.
- **`user_ranking_signals()` SQL**: one feature-rich row per signal, respects the Reset My Taste Profile boundary; users can only read their own.
- **Impression logging** (`recommendation_impressions`: request id, position, score, exploration flag, reasons, model version) — only with consent, never blocking the feed — so swipe-right rate and order conversion can be measured per model version.
- **API**: rules ranker on `GET /v1/feed`, `GET/PUT /v1/preferences` (validated), `GET /v1/taste-profile` (what the engine has learned, without exposing restaurant/creator ids as "tastes").
- **Mobile**: Food preferences screen (cuisines, show-me-less, explicit dietary requirements with allergen warning, spice, budget), "Your taste profile" transparency screen, reason line in the feed, optional new-user prompt.

### Tested
- Core: 25 recommendation tests on a synthetic Brisbane catalogue covering cold start, popularity, right/left swipe effects, gradual seafood reduction with the floor, quick skip vs. left swipe, orders vs. watches, repeat orders, spend learning, halal behaviour vs. no dietary inference, Brisbane timezone context, Friday-sushi boost, explicit dietary/halal filters, consent off, reset boundary, decay, exploration, determinism, diversity, and config overrides.
- API: ranker personalisation, no logging/history without consent, rejected-video hiding, weight overrides, logging failures not breaking the feed, preference validation, taste-profile output.
- Database: `user_ranking_signals` enrichment, ownership check, and reset boundary.

### Limitations
- The default weights are reasoned starting points, **not yet tuned on real data**. They must be evaluated during the pilot with the logged impressions (A/B by `model_version`).
- The profile is computed per request from up to 120 days of signals — fine for a pilot; needs precomputation (`user_feature_affinities`) or caching at scale.
- Exploration currently uses cuisine novelty only.

## Phase 4 — Restaurant onboarding, menus and creator uploads

### Built
- **Restaurant onboarding (web)**: business details with ABN checksum validation, legal name, cuisines, price level, Brisbane suburb, address, phone and prep time. Creates the restaurant (always `draft`, platform-default commission, enforced by the database), location, default hours and menu, and makes the creator the owner.
- **Restaurant dashboard (web)** per restaurant: overview with a go-live checklist and counts; **menu** management (sections, GST-inclusive prices, cuisine, dish type, tags, dietary labels, allergens, spice, GST-free flag, sold-out toggle that staff can use); **item photos** uploaded straight from the browser to storage under the owner's session; **customisations** (option groups with min/max and price changes); **hours** (weekly schedule incl. past-midnight, pause/resume orders, prep time, pickup, advance orders); **videos & creator tags** (approve/reject tags, upload existing promo videos with a rights confirmation, per-video stats); **verification** (licence number + private document upload, submits for review).
- **Admin (web)**: restaurant verification queue with signed links to private documents and approve/reject (audited, reason required); video moderation queue with previews, publish/reject via the API.
- **Publishing pipeline**: uploads land in a private bucket; on approval the API copies the file server-side to the public playback bucket, sets the playback URL and publishes (audited). Rejected/removed videos are taken down.
- **API**: `GET /v1/restaurants` (nearby + search by name, dish, cuisine, suburb; searches stored only with consent), `GET /v1/restaurants/:id` (details, today's hours, video menu with photo fallback, follow state), `PUT /v1/restaurants/:id/follow`, `GET /v1/menu-items/:id` (customisations + live orderability), `GET /v1/admin/videos`, `POST /v1/admin/videos/:id/moderate` (admin-only).
- **SQL**: `nearby_restaurants()`, `restaurant_video_menu()` (best approved video per item, otherwise photo), `restaurant_tag_requests()` (members only).
- **Mobile**: Discover tab (search, near me with explicit location permission, open/busy/closed, halal, video counts, matched dishes); restaurant page with video menu, photo fallback, today's hours and follow; full-screen video player; **Create** tab (record or choose a video up to 3 minutes, caption with hashtags, tag a verified restaurant's dish, sponsorship disclosure, restaurant-reuse permission, rights confirmation, streaming upload from disk with progress); **My videos** (review status, reviewer notes, tag status, views/craves/likes/shares, creator handle, affiliate application).

### Tested
- Database (32 tests, +6): discovery ordering/search/injection safety, video menu fallback and unverified hiding, tag-request access, a full onboarding → verification → discoverable flow as real users under RLS, and the creator upload flow (pending review, pending tag, sponsorship disclosure enforced, not in feed until published).
- API (31 tests, +6): search logging only with consent, 404 handling, follow scoping, admin-only moderation, reason required to reject, missing-upload handling.
- Core (56 tests, +6): ABN checksum, slugs, AU phone numbers, suburb data sanity.
- Web dashboard compiles (`next build`, 12 routes); mobile bundles for Android.

### Not yet verified / limitations
- The web dashboard and the upload/moderation pipeline have **not been exercised against a live Supabase project** (no Docker here). Storage behaviour (upload endpoint, cross-bucket copy) is per Supabase's API and needs a live run.
- Restaurant location uses the suburb's centre point; a geocoding provider is needed before delivery.
- No video transcoding or thumbnails yet: videos are served as uploaded. Uploads up to 500 MB are accepted; a streaming provider (HLS, thumbnails, compression) is needed before scale.
- No automatic content scanning; moderation is manual. Notifications to uploaders and restaurants (tag requests, decisions) are recorded in the dashboard only — push/email arrive with Phase 5.
- Creator attribution of orders and affiliate commissions are not live (affiliate applications are recorded only).

## Phase 5 — Ordering from videos, basket and pickup checkout

### Built
- **Order This Meal** from any eligible video (and from restaurant menus): opens the exact menu item with its current price, valid customisations only (required/optional groups, min/max, unavailable options disabled), quantity and kitchen notes; the video is recorded as the order's source.
- **Pricing engine** (`@crave/core/pricing`): server-authoritative quotes in integer cents — options, quantities, service fee (admin-configurable, validated), GST included (taxable lines + service fee, GST-free items supported), per-restaurant commission snapshot, restaurant net; caps on lines, quantities and order size. Clients never send prices.
- **Basket API**: one restaurant per basket (explicit "start a new basket" on conflict), re-priced from the database on every read, lines that became unavailable are flagged and block checkout.
- **Checkout API**: re-validates everything, refuses closed / paused / pickup-disabled restaurants, supports advance orders only where the restaurant allows them and only within opening hours, idempotent by a client key (double taps can't create two orders).
- **Database**: `create_pending_order` (atomic, idempotent, lines must belong to the restaurant and reconcile with the subtotal), `confirm_order_payment` (amount must equal the order total; duplicate confirmations are no-ops; releases the order to the restaurant, records **creator attribution** for approved video→item links with attributed revenue, updates video order/revenue stats, notifies restaurant staff), automatic **refund requests** when a paid order is rejected or cancelled, and `customer_cancel_order` (only before the restaurant accepts).
- **Payment step — SIMULATED**: `PAYMENTS_MODE=simulated` enables a clearly labelled "TEST PAYMENT — no real money is taken" step. The API refuses to start with it in production, and the database forbids a simulated payment ever being marked live. Stripe replaces it in Phase 7.
- **Merchant acceptance (web)**: live order queue (auto-refresh every 15 s) with accept → preparing → ready → collected, decline/cancel with a required reason (customer notified, refund request created), and per-order food / commission / net breakdown. Restaurants see the pickup name only — never the customer's email or phone.
- **Mobile**: item sheet, basket (quantities, fees, GST line, pickup name, note), test payment screen, live order status (polls every 10 s; real restaurant updates only — no simulated tracking), customer cancellation before acceptance, Orders tab with basket shortcut. Ordering buttons in the feed and restaurant menus are now live (disabled in demo mode).

### Tested
- Core (66, +10): selection validation, pricing incl. options/quantities/GST-free/commission rates, invalid baskets, reconciliation property over many prices, fee config validation.
- API (41, +10): server-side pricing ignores client prices, invalid customisations, one-restaurant baskets, sold-out after adding, checkout refusal when closed/paused/pickup off, advance-order rules, idempotency key and video attribution passed through, disabled payments, simulated payment ownership/mode/amount, production refusal of simulated mode.
- Database (35, +3): idempotent order creation, backend-only creation, amount mismatch rejected, duplicate confirmation no-op, creator attribution and video revenue, restaurant notification, simulated-can't-be-live constraint, cross-restaurant items rejected, customer cancel / restaurant reject → refund requests, cancel blocked after acceptance and for other users.

### Not production-ready
- **No real payments yet.** Refund *requests* are recorded but not executed against a provider. Both are Phase 7 (Stripe Connect).
- Order updates use polling (mobile 10 s, dashboard 15 s); push notifications and realtime subscriptions are not built yet.
- Restaurant staff get in-app notification records only; no sound alert / printer integration for new orders.
- Delivery is not offered (pickup only), by design until Phase 8.
- GST treatment of the service fee and commission, tax invoices/receipts, and the agent-vs-principal model need accountant review.
