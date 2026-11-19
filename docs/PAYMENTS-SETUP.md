# Turning on ordering & card payments (Stripe)

CRAVE takes payments with **Stripe Connect**: the customer pays, Stripe sends the restaurant its share
automatically, and CRAVE keeps its commission. Card details go straight to Stripe — CRAVE never sees them.

Do everything in **test mode** first (toggle at the top right of the Stripe dashboard). Nothing real is
charged; you pay with Stripe's test card `4242 4242 4242 4242`, any future expiry, any 3-digit CVC.

## 1. Stripe account (once)
1. Sign up at **stripe.com** as the business (Australia, your ABN).
2. **Connect → Get started** → choose the **platform / marketplace** option. Restaurants will be
   "connected accounts" that receive payouts.

## 2. Keys → Render (crave-api → Environment)
Stripe → **Developers → API keys** (test mode):

| Render key | Value |
|---|---|
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
| `STRIPE_SECRET_KEY` | `sk_test_…` (click "Reveal") |

## 3. Webhooks (Stripe tells CRAVE a payment worked)
Stripe → **Developers → Webhooks → Add endpoint**, twice, both to
`https://<your crave-api address>/webhooks/stripe`:

1. **"Your account"** events: `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
   `refund.created`, `refund.updated`, `refund.failed`.
2. **"Connected accounts"** events: `account.updated`, `payout.created`, `payout.updated`,
   `payout.paid`, `payout.failed`.

Each endpoint shows a **signing secret** (`whsec_…`). Put both in Render as
`STRIPE_WEBHOOK_SECRETS`, separated by a comma: `whsec_aaa,whsec_bbb`.

## 4. Switch it on
Render → crave-api → Environment → `PAYMENTS_MODE` = `stripe` → **Save, rebuild and deploy**.
The app picks it up by itself (no app rebuild): "Ordering soon" becomes "Order now".
If a key is missing or test/live keys are mixed, the new version refuses to start and the old one keeps
running — check the deploy log.

## 5. Each restaurant connects its bank account
Restaurant owner → dashboard → **Payouts → Set up payouts** (Stripe's own form: business details,
bank account, ID). Until that's done, their dishes show but checkout says
"This restaurant can't take card payments yet".

## 6. Test order
Swipe right on a dish → choose options → Add to basket → Place pickup order → Pay with `4242 4242 4242 4242`.
The order shows "TEST ORDER" and appears on the restaurant's Orders screen. Try a refund from the
dashboard too.

## 7. Go live
Repeat steps 2–3 with the **live** keys (`pk_live_…`, `sk_live_…`, new live webhook secrets).
Stripe must have approved your account (it asks for business details before live payouts).

**Apple Pay in the browser** also needs your app's domain registered in Stripe
(Settings → Payment methods → Payment method domains). Cards and Google Pay work without it.
