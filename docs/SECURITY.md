# CRAVE security review (Phase 7)

Scope: database (Supabase/PostgreSQL), API (`services/api`), web dashboards (`apps/web`), mobile app (`apps/mobile`), payments (Stripe Connect). This is an engineering self-review, **not** a substitute for an independent penetration test, which should be done before public launch.

## Architecture and trust boundaries

| Component | Credentials it holds | Trust |
| --- | --- | --- |
| Mobile app | Supabase **anon** key, Stripe **publishable** key, user's own session (Keychain/Keystore) | Untrusted |
| Web dashboard | Supabase anon key, user's session cookie (httpOnly, refreshed by `proxy.ts`) | Untrusted browser; server components run as the user |
| API | Supabase **service role** key, Stripe **secret** key, webhook secrets | Trusted, server-only |
| Database | Row-level security on every table; privileged logic in guarded functions | Final authority |

## Controls in place (and how they're verified)

- **Authorisation in the database, not just the UI.** RLS is enabled on every table (test fails if any table lacks it). Every `SECURITY DEFINER` function that isn't a trigger checks the caller (admin, backend, owner or restaurant member); a static test inspects every such function and fails if a new one has no guard. This test found two issues during the review (below).
- **Field protection triggers** stop owners self-verifying restaurants or changing commission/payout fields, uploaders self-publishing videos, creators self-approving menu tags and users editing privacy timestamps. Order totals are immutable and order status follows a state machine enforced in SQL.
- **Money**: integer cents everywhere; prices are recomputed server-side from the database; clients never submit amounts. Order creation is atomic and idempotent; payment confirmation must match the order total exactly; refunds can never exceed the amount paid.
- **Payments**: card data goes straight from the device to Stripe (PaymentSheet) — CRAVE never handles card numbers, keeping PCI scope to SAQ-A. An order is released to a restaurant **only** after a signature-verified Stripe webhook; webhooks are processed at most once; failures return 500 so Stripe retries. Simulated payments cannot be enabled in production and cannot be marked live (database constraint).
- **Refunds** use a database lease so two workers can't claim the same refund, plus Stripe idempotency keys (the refund id) as a second guard against double refunds.
- **Secrets**: the service role key and Stripe secret key exist only in the API's environment. The app/web only ever receive anon/publishable keys. `.env` files are git-ignored; startup fails fast on missing or inconsistent configuration.
- **API hardening**: bearer tokens verified with Supabase Auth on every `/v1` request; security headers; CORS allow-list; 256 KB body limit; zod validation on every input; internal errors never leaked to clients; per-user rate limits (general 120 burst / 2 s⁻¹, checkout 5 burst, events and basket limits).
- **Web**: open-redirect-safe sign-in redirects; `X-Frame-Options: DENY`, `nosniff`, strict referrer policy; uploads go browser → storage under the user's session so storage policies apply.
- **Storage**: per-user/per-restaurant folders enforced by storage policies; verification documents and raw video uploads are private; only moderated videos are copied to the public playback bucket.
- **Privacy**: behavioural data stored only with personalisation consent; dietary filters only from explicit choices; restaurants see a pickup name only; Reset My Taste Profile; account deletion removes the auth user, uploads and personal data while keeping anonymised financial records; admin actions are audited.
- **UGC safety**: moderation before publication, reporting, blocking, appeals, sponsorship disclosure enforced by a database constraint.

## Issues found and fixed in this review

1. **`has_consent(user_id)` information leak** — any signed-in user could query another user's consent choices. Now restricted to self/admin/backend (`20261102000016_hardening.sql`), with a regression test.
2. **`bump_video_stats` relied only on grants** — added an in-function backend-only guard (defence in depth).
3. Earlier phases (found by tests): `SECURITY DEFINER` field-protection triggers originally checked `current_user`, which is always the owner inside a definer function — replaced with a JWT-role check; the refund queue could hand out the same refund twice — fixed with a lease.

## Known gaps / before public launch

- Independent penetration test and a review of Supabase project settings (auth rate limits, email confirmation on, leaked-password protection, MFA for admin accounts, network restrictions on the database).
- Rate limiting is in-memory per API instance; use a shared store or edge rate limiting when running more than one instance.
- Admin is a single role; split into support / finance / moderation sub-roles with least privilege, and require MFA.
- `npm audit`: 0 high/critical, 12 moderate (transitive) in production dependencies — review on each release.
- No automated malware/CSAM scanning of uploads; moderation is manual. Add a scanning service before opening uploads widely.
- Logging/monitoring (Sentry or similar), alerting on webhook failures, and a security incident response plan (including Notifiable Data Breaches scheme obligations under the Privacy Act 1988).
