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
