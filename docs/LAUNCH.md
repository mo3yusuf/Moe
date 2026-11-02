# Pilot launch checklist (Brisbane)

Items marked ⚖️ need professional legal, privacy or accounting advice. Nothing here is legal advice.

## Accounts and services
- [ ] Supabase project (production + staging), Pro plan, daily backups / PITR, Brisbane-near region (Sydney `ap-southeast-2`).
- [ ] Stripe Australia account with **Connect** enabled (platform profile describing CRAVE as a food-ordering marketplace). Create two webhook endpoints pointing at `https://<api>/webhooks/stripe`:
  - Platform events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created|updated|closed`.
  - Connect events: `account.updated`, `payout.created|updated|paid|failed`.
  Put both signing secrets in `STRIPE_WEBHOOK_SECRETS` (comma-separated).
- [ ] Apple Developer Program (organisation), Apple Pay merchant ID `merchant.app.crave.mobile` registered with Stripe.
- [ ] Google Play Console; Google Pay enabled in Stripe.
- [ ] Expo/EAS account; `eas build --profile production`, `eas submit`.
- [ ] API hosting (any Node 20+ host: Fly.io, Render, Railway, AWS) with HTTPS; set `NODE_ENV=production`, `PAYMENTS_MODE=stripe`, live keys, `WEB_BASE_URL`, `CORS_ORIGINS`. Run a single instance until rate limiting and the worker are moved to shared infrastructure.
- [ ] Web dashboard hosting (Vercel or similar) at a `business.` subdomain.
- [ ] Domain, transactional email (Supabase SMTP via Postmark/SES), error monitoring (Sentry).
- [ ] Video: move to a streaming provider (Mux / Cloudflare Stream) for transcoding, HLS and thumbnails before volume grows.

## Legal and compliance ⚖️
- [ ] Decide the marketplace model: is the restaurant the seller (CRAVE as agent) or CRAVE? This drives GST treatment, tax invoices, `STRIPE_ON_BEHALF_OF`, and consumer-law responsibilities.
- [ ] GST registration; GST on commission and service fee; tax invoices/receipts for customers and restaurants (RCTI arrangements if applicable).
- [ ] Terms of Service (customers), Restaurant Partner Agreement (commission, payouts, refunds, chargebacks, content licence), Creator Terms (content licence, sponsorship disclosure, affiliate terms).
- [ ] Privacy Policy and collection notices under the Privacy Act 1988 / APPs (personalisation, location, overseas disclosure to Supabase/Stripe/Expo, retention periods, access/correction, complaints). Replace `PRIVACY_POLICY_VERSION = 2026-11-draft`.
- [ ] Australian Consumer Law: total price display incl. fees (done in-app — confirm wording), refund policy, no misleading dietary claims (restaurant-declared labels + allergen disclaimer are in place).
- [ ] ACCC influencer/advertising disclosure guidance for sponsored creator content (disclosure enforced; review wording).
- [ ] Food safety: restaurants must hold a current food business licence (collected at verification); confirm council requirements.
- [ ] Minimum age policy (currently 16+ self-declared) and handling of minors' data.
- [ ] Notifiable Data Breaches response plan.

## App Store / Google Play review
- [x] Account deletion available in-app (Privacy → Delete my account) and actually deletes data (worker).
- [x] User-generated content: moderation before publication, report content, block users, published contact for support.
- [x] Permission strings explain purpose (location, camera, microphone, photos); location is optional.
- [x] iOS privacy manifest declared in `app.json`; complete the App Store privacy "nutrition label" to match (email, name, coarse location, purchase history, product interaction, photos/videos, user content — not used for tracking).
- [x] Physical goods/meals are paid with Stripe/Apple Pay (not in-app purchase), which is permitted for real-world goods.
- [ ] Demo account for reviewers (customer with a test restaurant), and review notes explaining pickup ordering in Brisbane.
- [ ] Google Play Data safety form matching the above.
- [ ] Support URL, marketing URL, privacy policy URL.

## Operational readiness
- [ ] Seed real launch restaurants (verified), replace demo videos with licensed food footage; remove `supabase/seed.sql` demo data from production.
- [ ] Moderation rota and response targets (videos, reports, appeals), restaurant support hours.
- [ ] Refund/dispute runbook; daily reconciliation check (Admin → Payments).
- [ ] Monitor: failed webhooks, refund failures, unpaid-order expiry, API error rate.
- [ ] Tune recommendation weights and fraud thresholds after the first weeks of pilot data.
