# CRAVE roadmap & phase status

Legend: ✅ built and covered by automated tests · 🟡 built, verified manually or partly · ⏳ not built

## Phase 1 — Setup, database, authentication, navigation ✅

| Item | Status | Evidence |
| --- | --- | --- |
| Monorepo (npm workspaces): `apps/mobile`, `apps/api`, `packages/core` | ✅ | `npm run typecheck` |
| Normalised multi-market PostgreSQL schema (8 migrations) | ✅ | applied to PG16 by `scripts/db-local-reset.sh` |
| RLS on every table + guard triggers | ✅ | 22 tests in `apps/api/test/rls.test.ts` |
| Demo seed: 7 fictional Brisbane restaurants, 21 dishes, 15 videos, 12 users | ✅ | `scripts/generate-seed.mjs` |
| Supabase Auth: email sign-up/sign-in, session in Keychain/Keystore, consent capture | 🟡 | typechecked; sign-up trigger records consents. **Not run against a live Supabase Auth server yet** |
| Five-tab navigation (Home, Discover, Create, Orders, Profile) | 🟡 | rendered in a web build (mobile viewport). Not yet run on a physical device |

## Phase 2 — Vertical video feed & Smart Swipe 🟡

| Item | Status |
| --- | --- |
| Full-screen vertical paging, autoplay/loop, neighbour preloading, player release | 🟡 code complete; video playback not verified on device (sample clips unreachable from the build sandbox) |
| CRAVE IT / NOT FOR ME swipe with thresholds, stamps, haptics, confirmation toast | ✅ classification unit-tested · 🟡 gesture verified in browser build |
| Accessible equivalents (Crave and Nope buttons, screen-reader actions) | 🟡 |
| Like, save (Cravings), share, comments, follow creators, report comments | 🟡 like/save via API (tested); follows/comments via Supabase RLS (policies tested; UI not run against live Supabase) |
| Watch-time tracking: quick skip vs long view, no duplicate signals on back-navigation | ✅ |
| For You, Following, Nearby (orderable only), Trending feeds | ✅ |
| Order Now button → live menu item with customisations | 🟡 screen built; **adding to basket is disabled until Phase 5** |
| Restaurant page with video menu, hours, open/closed | 🟡 |

## Phase 3 — Recommendation engine & taste profile ✅

| Item | Status |
| --- | --- |
| Configurable weights, decay, damped negatives, cold start, exploration, diversity | ✅ 22 unit tests |
| Idempotent event ingestion → taste profile (transactional, row-locked) | ✅ |
| Explicit preferences: cuisines, strict requirements, avoid ingredients/allergens, spice | ✅ ranking · 🟡 preferences screen |
| Personalisation off = nothing recorded | ✅ |
| Reset My Taste Profile + "what CRAVE has learned" transparency | ✅ |
| Impression logging for evaluation | ✅ |

## Phase 4 — Restaurant onboarding, menus, creator uploads ⏳
Database, RLS and validation are ready: drafts → verification → admin approval, menu/modifier tables, staff vs manager permissions, creator tags pending until approved, auto-approve permission, rights confirmation and sponsorship disclosure. **Still to build:** the upload UI (camera/library picker, resumable upload to Storage, server-side validation/publish endpoint, thumbnails), restaurant onboarding screens and a tag-approval inbox.

## Phase 5 — Basket & pickup checkout ⏳
Pricing (`quoteBasket`), orderability, the order state machine and order/payment tables are built and tested. **Still to build:** basket API, order placement endpoint (idempotent), Stripe PaymentIntent + Apple Pay / Google Pay via PaymentSheet (test mode), webhook handler, confirmation screen, order tracking (Supabase Realtime) and order history.

## Phase 6 — Merchant & admin dashboards (Next.js) ⏳
Merchant: menus, hours, media, orders board, tag approvals, sales/video attribution, commission. Admin: verification queue, moderation, refunds, commission configuration, fraud flags, recommendation metrics. Reporting views `restaurant_daily_sales` and `video_sales_performance` already exist.

## Phase 7 — Payments hardening, security, testing, pilot ⏳
Stripe Connect onboarding (Express accounts), refunds/disputes/reconciliation, payout reports, account deletion flow, rate limiting, audit logging, penetration test, E2E tests (Maestro/Detox), EAS production builds, store listings, privacy labels.

## Phase 8 — Delivery, creator rewards, advanced recommendations ⏳

## Known limitations right now
- Demo videos are generic sample clips, not food. Replace them with licensed food footage.
- No real restaurants, payments or orders. Nothing can be purchased.
- Allergen and halal information is restaurant-declared demo data.
- Policy text (Terms, Privacy Policy) does not exist yet. The sign-up screen references drafts pending legal review.
- No push notifications, search index, rate limiting or error monitoring (Sentry) yet.
- Signed-out "exclude" paging is capped at 200 IDs per session.
