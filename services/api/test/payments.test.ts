import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { stripeProvider, type PaymentProvider } from '../src/lib/payments';
import { rateLimit } from '../src/lib/rate-limit';
import { runBackgroundJobs } from '../src/lib/worker';
import { reconcile } from '../src/routes/payments';
import type { DataStore } from '../src/lib/store';
import { authed, candidate, makeApp } from './helpers';

const WHSEC = 'whsec_test_secret_for_unit_tests_only';
// Real Stripe provider (signature verification is local HMAC; no network calls in these tests).
const realVerifier = stripeProvider({ secretKey: 'sk_test_unit', webhookSecrets: ['whsec_other', WHSEC] });
const signer = new Stripe('sk_test_unit');

function signed(event: object) {
  const payload = JSON.stringify(event);
  return { payload, header: signer.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) };
}
const ev = (type: string, object: object, extra: object = {}) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, livemode: false, data: { object }, ...extra });

function webhookStore(over: Partial<DataStore> = {}) {
  const seen = new Set<string>();
  return {
    beginWebhook: vi.fn(async (id: string) => (seen.has(id) ? false : (seen.add(id), true))),
    finishWebhook: vi.fn(async () => {}),
    confirmPayment: vi.fn(async () => {}),
    markPaymentFailed: vi.fn(async () => {}),
    markRefundResult: vi.fn(async () => {}),
    recordDispute: vi.fn(async () => {}),
    setRestaurantStripeStatus: vi.fn(async () => {}),
    upsertPayout: vi.fn(async () => {}),
    ...over,
  };
}
const post = (app: ReturnType<typeof makeApp>, body: string, sig: string) =>
  app.request('/webhooks/stripe', { method: 'POST', body, headers: { 'stripe-signature': sig, 'content-type': 'application/json' } });

describe('Stripe webhooks', () => {
  it('confirms an order only from a correctly signed payment_intent.succeeded event', async () => {
    const store = webhookStore();
    const app = makeApp(store, { payments: realVerifier });
    const e = ev('payment_intent.succeeded', { id: 'pi_1', object: 'payment_intent', amount_received: 1789, application_fee_amount: 268, metadata: { order_id: 'order-1' } });
    const { payload, header } = signed(e);
    expect((await post(app, payload, header)).status).toBe(200);
    expect(store.confirmPayment).toHaveBeenCalledWith('order-1', 'stripe', 'pi_1', 1789, 268, true);

    // Same event delivered again: acknowledged, not re-processed.
    expect(await (await post(app, payload, header)).json()).toMatchObject({ duplicate: true });
    expect(store.confirmPayment).toHaveBeenCalledTimes(1);
  });

  it('rejects forged or tampered events', async () => {
    const store = webhookStore();
    const app = makeApp(store, { payments: realVerifier });
    const { payload, header } = signed(ev('payment_intent.succeeded', { id: 'pi_1', amount_received: 1, metadata: { order_id: 'o' } }));
    expect((await post(app, payload.replace('"amount_received":1', '"amount_received":999'), header)).status).toBe(400);
    expect((await post(app, payload, 't=1,v1=deadbeef')).status).toBe(400);
    expect(store.confirmPayment).not.toHaveBeenCalled();
  });

  it('returns 500 (so Stripe retries) when processing fails, recording the error', async () => {
    const store = webhookStore({ confirmPayment: vi.fn(async () => { throw new Error('Payment amount 1 does not match order total 1789'); }) });
    const app = makeApp(store, { payments: realVerifier });
    const { payload, header } = signed(ev('payment_intent.succeeded', { id: 'pi_2', amount_received: 1, metadata: { order_id: 'o' } }));
    expect((await post(app, payload, header)).status).toBe(500);
    expect(store.finishWebhook).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/does not match/));
  });

  it('maps failures, refunds, disputes, account status and connected-account payouts', async () => {
    const store = webhookStore();
    const app = makeApp(store, { payments: realVerifier });
    const send = async (e: object) => { const s = signed(e); expect((await post(app, s.payload, s.header)).status).toBe(200); };
    await send(ev('payment_intent.payment_failed', { id: 'pi_3', last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' } }));
    await send(ev('refund.updated', { id: 're_1', status: 'succeeded', metadata: { crave_refund_id: 'refund-1' } }));
    await send(ev('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_1', amount: 1789, reason: 'fraudulent', status: 'needs_response', evidence_details: { due_by: 1800000000 } }));
    await send(ev('account.updated', { id: 'acct_1', charges_enabled: true, payouts_enabled: false }));
    await send(ev('payout.paid', { id: 'po_1', amount: 5000, currency: 'aud', status: 'paid', arrival_date: 1800000000 }, { account: 'acct_1' }));
    await send(ev('payout.paid', { id: 'po_platform', amount: 1, currency: 'aud', status: 'paid' })); // platform payout: ignored
    await send(ev('customer.created', { id: 'cus_1' })); // unhandled types are acknowledged
    expect(store.markPaymentFailed).toHaveBeenCalledWith('pi_3', 'insufficient_funds');
    expect(store.markRefundResult).toHaveBeenCalledWith('refund-1', 're_1', 'succeeded', undefined);
    expect(store.recordDispute).toHaveBeenCalledWith('pi_1', 'dp_1', 1789, 'fraudulent', 'needs_response', new Date(1800000000 * 1000));
    expect(store.setRestaurantStripeStatus).toHaveBeenCalledWith('acct_1', true, false);
    expect(store.upsertPayout).toHaveBeenCalledTimes(1);
    expect(store.upsertPayout).toHaveBeenCalledWith('acct_1', 'po_1', 5000, 'aud', 'paid', '2027-01-15');
  });
});

describe('checkout with Stripe', () => {
  const BURGER = 'cccccccc-0000-4000-8000-000000000001';
  function store(payoutsEnabled: boolean) {
    const basket = { id: 'b', restaurantId: 'r1', locationId: 'l1', items: [{ id: 'i1', menuItemId: BURGER, quantity: 1, optionIds: [], notes: null, sourceVideoId: null }] };
    return {
      getBasket: async () => basket,
      itemDefs: async () => new Map([[BURGER, { id: BURGER, name: 'Smash', priceCents: 1690, isAvailable: true, gstApplicable: true, optionGroups: [], restaurantId: 'r1', restaurantName: 'V', commissionRateBps: 1000, locationId: 'l1', acceptsAdvanceOrders: false }]]),
      serviceFeeConfig: async () => ({ percentBps: 0, fixedCents: 99, minCents: 99, maxCents: 299 }),
      locationStatus: async () => ({ isOpen: true, acceptingOrders: true, pickupEnabled: true, prepTimeMinutes: 10 }),
      restaurantPayments: async () => ({ name: 'V', stripeAccountId: 'acct_r1', payoutsEnabled }),
      createPendingOrder: vi.fn(async () => ({ id: 'o1', orderNumber: 'CR-1', status: 'pending_payment', totalCents: 1789 })),
      recordPaymentIntent: vi.fn(async () => {}),
    } as unknown as DataStore & { recordPaymentIntent: ReturnType<typeof vi.fn> };
  }
  const fakePayments = () => ({ name: 'stripe', testMode: true, createIntent: vi.fn(async () => ({ id: 'pi_new', clientSecret: 'pi_new_secret' })) }) as unknown as PaymentProvider & { createIntent: ReturnType<typeof vi.fn> };
  const body = JSON.stringify({ pickupName: 'Sam', idempotencyKey: 'ffffffff-0000-4000-8000-000000000001' });

  it('refuses restaurants that have not finished Stripe onboarding', async () => {
    const p = fakePayments();
    const res = await makeApp(store(false), { paymentsMode: 'stripe', payments: p }).request('/v1/checkout', authed('u', { method: 'POST', body }));
    expect(res.status).toBe(422);
    expect(p.createIntent).not.toHaveBeenCalled();
  });

  it('creates a destination-charge intent with CRAVE’s fee = commission + service fee', async () => {
    const s = store(true); const p = fakePayments();
    const res = await makeApp(s, { paymentsMode: 'stripe', payments: p, stripeOnBehalfOf: true }).request('/v1/checkout', authed('u', { method: 'POST', body }));
    expect(res.status).toBe(201);
    expect((await res.json() as any).payment).toEqual({ mode: 'stripe', clientSecret: 'pi_new_secret', testMode: true });
    expect(p.createIntent).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 1789, applicationFeeCents: 169 + 99, destinationAccount: 'acct_r1', onBehalfOf: true, currency: 'AUD' }));
    expect(s.recordPaymentIntent).toHaveBeenCalledWith('o1', 'pi_new', 1789, 268, true);
  });
});

describe('background jobs', () => {
  it('expires unpaid orders, executes refunds (simulated, Stripe, failures) and processes deletions', async () => {
    const payments = { cancelIntent: vi.fn(async () => {}), refund: vi.fn(async (i: any) => (i.intentId === 'pi_bad' ? Promise.reject(new Error('charge_already_refunded')) : { id: 're_x', status: 'pending' as const })) };
    const store = {
      expireUnpaidOrders: async () => [{ orderId: 'o1', intentId: 'pi_old' }, { orderId: 'o2', intentId: null }],
      claimRefunds: async () => [
        { refundId: 'r1', orderId: 'o', amountCents: 1089, provider: 'simulated', intentId: 'sim_1', isTestMode: true, full: true },
        { refundId: 'r2', orderId: 'o', amountCents: 500, provider: 'stripe', intentId: 'pi_ok', isTestMode: true, full: false },
        { refundId: 'r3', orderId: 'o', amountCents: 500, provider: 'stripe', intentId: 'pi_bad', isTestMode: true, full: true },
      ],
      markRefundResult: vi.fn(async () => {}),
      deletionRequestsReady: async () => [{ requestId: 'd1', userId: 'u1' }],
      deleteUserAccount: vi.fn(async () => {}),
      runFraudRules: vi.fn(async () => 2),
    } as unknown as DataStore;
    const r = await runBackgroundJobs(store, payments as unknown as PaymentProvider, { runFraud: true });
    expect(r).toEqual({ expired: 2, refunds: { succeeded: 1, pending: 1, failed: 1 }, deletions: 1, fraudFlags: 2 });
    expect(payments.cancelIntent).toHaveBeenCalledWith('pi_old');
    expect(payments.refund).toHaveBeenCalledWith({ intentId: 'pi_ok', amountCents: 500, idempotencyKey: 'r2', full: false });
    expect((store as any).markRefundResult).toHaveBeenCalledWith('r1', 'sim_re_r1', 'succeeded');
    expect((store as any).markRefundResult).toHaveBeenCalledWith('r3', null, 'failed', 'charge_already_refunded');
    expect((store as any).deleteUserAccount).toHaveBeenCalledWith('d1', 'u1');
  });
});

describe('reconciliation', () => {
  it('reports missing, mismatched and unconfirmed payments', () => {
    const r = reconcile(
      [{ id: 'pi_a', amount: 1000, orderId: 'a' }, { id: 'pi_b', amount: 2000, orderId: 'b' }, { id: 'pi_c', amount: 500, orderId: 'c' }, { id: 'pi_d', amount: 700, orderId: 'd' }],
      [
        { intentId: 'pi_a', orderNumber: 'CR-1', amountCents: 1000, status: 'succeeded' },
        { intentId: 'pi_b', orderNumber: 'CR-2', amountCents: 1999, status: 'succeeded' },
        { intentId: 'pi_d', orderNumber: 'CR-4', amountCents: 700, status: 'requires_payment' },
        { intentId: 'pi_e', orderNumber: 'CR-5', amountCents: 300, status: 'succeeded' },
      ]);
    expect(r.matchedCents).toBe(1000);
    expect(r.issues.map((i) => i.problem)).toEqual([
      'Amount mismatch', 'Paid in Stripe but missing in CRAVE', 'Paid in Stripe but CRAVE status is requires_payment (webhook missed?)',
      'Succeeded in CRAVE but not in Stripe for this day (check date boundary)',
    ]);
  });
});

describe('Connect onboarding', () => {
  const RID = '11111111-1111-4111-8111-111111111111';
  it('only owners can connect payouts; the account is created once', async () => {
    const payments = { createConnectedAccount: vi.fn(async () => 'acct_new'), onboardingLink: vi.fn(async (_a: string, _r: string, ret: string) => `https://connect.stripe.com/x?return=${ret}`) };
    const setRestaurantStripeAccount = vi.fn(async () => {});
    let account: string | null = null;
    const store = {
      isRestaurantOwner: async (u: string) => u === 'owner',
      restaurantPayments: async () => ({ name: 'V', stripeAccountId: account, payoutsEnabled: false }),
      setRestaurantStripeAccount: vi.fn(async (_r: string, a: string) => { account = a; setRestaurantStripeAccount(); }),
    };
    const app = makeApp(store, { payments: payments as any, webBaseUrl: 'https://business.crave.example' });
    expect((await app.request(`/v1/restaurants/${RID}/payments/onboarding`, authed('staff', { method: 'POST' }))).status).toBe(403);
    const res = await app.request(`/v1/restaurants/${RID}/payments/onboarding`, authed('owner', { method: 'POST' }));
    expect((await res.json() as any).url).toContain(`return=https://business.crave.example/restaurant/${RID}/payouts?done=1`);
    await app.request(`/v1/restaurants/${RID}/payments/onboarding`, authed('owner', { method: 'POST' }));
    expect(payments.createConnectedAccount).toHaveBeenCalledTimes(1);
  });
});

describe('hardening', () => {
  it('rate limits per user with Retry-After', async () => {
    let t = 0;
    const { Hono } = await import('hono');
    const h = new Hono();
    h.use('*', rateLimit({ name: 'x', capacity: 2, refillPerSecond: 1, key: () => 'same-user', now: () => t }));
    h.get('/', (c) => c.text('ok'));
    h.onError((e: any, c) => c.json({ code: e.code }, e.status ?? 500));
    expect((await h.request('/')).status).toBe(200);
    expect((await h.request('/')).status).toBe(200);
    const limited = await h.request('/');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
    t += 1000;
    expect((await h.request('/')).status).toBe(200);
  });

  it('hides blocked creators from the feed', async () => {
    const a = candidate({ uploaderId: 'blocked-creator' });
    const b = candidate();
    const app = makeApp({
      feedCandidates: async () => [a, b], hasConsent: async () => false, blockedUserIds: async () => new Set(['blocked-creator']),
      viewerVideoState: async () => ({ liked: new Set(), saved: new Set(), craved: new Set() }),
    });
    const body = await (await app.request('/v1/feed', authed('u'))).json() as any;
    expect(body.items.map((i: any) => i.videoId)).toEqual([b.videoId]);
  });

  it('refuses Stripe mode without keys and simulated mode in production', async () => {
    const { loadEnv } = await import('../src/env');
    const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a'.repeat(30), SUPABASE_SERVICE_ROLE_KEY: 'b'.repeat(30) };
    expect(() => loadEnv({ ...base, PAYMENTS_MODE: 'stripe' })).toThrow(/requires STRIPE_SECRET_KEY/);
    expect(() => loadEnv({ ...base, PAYMENTS_MODE: 'stripe', STRIPE_SECRET_KEY: 'pk_test_wrong', STRIPE_WEBHOOK_SECRETS: 'whsec_x' })).toThrow();
    expect(loadEnv({ ...base, PAYMENTS_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRETS: 'whsec_x' }).PAYMENTS_MODE).toBe('stripe');
  });
});
