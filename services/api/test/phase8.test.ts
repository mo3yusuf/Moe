import { createHmac } from 'node:crypto';
import { candidateFeatures, EMPTY_PREFERENCES } from '@crave/core';
import { describe, expect, it, vi } from 'vitest';
import { sandboxDeliveryProvider } from '../src/lib/delivery';
import { rulesRanker } from '../src/lib/ranker';
import { runBackgroundJobs } from '../src/lib/worker';
import type { DataStore } from '../src/lib/store';
import { authed, candidate, makeApp } from './helpers';

const BURGER = 'cccccccc-0000-4000-8000-000000000001';
const KEY = 'ffffffff-0000-4000-8000-000000000001';
const address = { line1: '12 Merthyr Rd', suburb: 'New Farm', region: 'QLD', postcode: '4005', lat: -27.467, lng: 153.045, contactPhone: '0412 345 678', instructions: 'Leave at door' };

function deliveryStore(over: { deliveryEnabled?: boolean } = {}) {
  const basket = { id: 'b', restaurantId: 'r1', locationId: 'l1', items: [{ id: 'i1', menuItemId: BURGER, quantity: 2, optionIds: [], notes: null, sourceVideoId: null }] };
  return {
    getBasket: async () => basket,
    itemDefs: async () => new Map([[BURGER, { id: BURGER, name: 'Smash', priceCents: 1690, isAvailable: true, gstApplicable: true, optionGroups: [], restaurantId: 'r1', restaurantName: 'V', commissionRateBps: 1000, locationId: 'l1', acceptsAdvanceOrders: false }]]),
    serviceFeeConfig: async () => ({ percentBps: 0, fixedCents: 99, minCents: 99, maxCents: 299 }),
    locationStatus: async () => ({ isOpen: true, acceptingOrders: true, pickupEnabled: true, prepTimeMinutes: 10 }),
    deliveryLocation: async () => ({ deliveryEnabled: over.deliveryEnabled ?? true, deliveryRadiusKm: 5, deliveryMinOrderCents: 2000, lat: -27.4575, lng: 153.0355, address: '1 Demo Lane, Fortitude Valley QLD 4006' }),
    createPendingOrder: vi.fn(async (i: any) => ({ id: 'o1', orderNumber: 'CR-1', status: 'pending_payment', totalCents: i.quote.totalCents })),
    createDelivery: vi.fn(async () => {}),
  };
}

describe('delivery', () => {
  const sandbox = sandboxDeliveryProvider('test-secret-1234567890');

  it('is unavailable (pickup only) when no delivery partner is configured', async () => {
    const res = await makeApp(deliveryStore()).request('/v1/delivery/quote', authed('u', { method: 'POST', body: JSON.stringify({ address }) }));
    expect(res.status).toBe(422);
    expect((await res.json() as any).error.code).toBe('delivery_unavailable');
  });

  it('quotes from the partner and adds the fee to the server-side total', async () => {
    const res = await makeApp(deliveryStore(), { delivery: sandbox }).request('/v1/delivery/quote', authed('u', { method: 'POST', body: JSON.stringify({ address }) }));
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.deliveryFeeCents).toBeGreaterThan(499);
    expect(body.quote.totalCents).toBe(3380 + 99 + body.deliveryFeeCents);
    expect(body.quote.deliveryFeeCents).toBe(body.deliveryFeeCents);
  });

  it('enforces restaurant delivery settings and validates AU addresses', async () => {
    const off = await makeApp(deliveryStore({ deliveryEnabled: false }), { delivery: sandbox }).request('/v1/delivery/quote', authed('u', { method: 'POST', body: JSON.stringify({ address }) }));
    expect((await off.json() as any).error.code).toBe('delivery_disabled');
    const far = await makeApp(deliveryStore(), { delivery: sandbox }).request('/v1/delivery/quote', authed('u', { method: 'POST', body: JSON.stringify({ address: { ...address, lat: -27.58, lng: 153.06 } }) }));
    expect((await far.json() as any).error.code).toBe('out_of_range');
    for (const bad of [{ ...address, postcode: '400' }, { ...address, contactPhone: '123' }, { ...address, lat: 40 }, { ...address, region: 'XX' }]) {
      const r = await makeApp(deliveryStore(), { delivery: sandbox }).request('/v1/delivery/quote', authed('u', { method: 'POST', body: JSON.stringify({ address: bad }) }));
      expect(r.status).toBe(400);
    }
  });

  it('checkout re-quotes delivery on the server and stores the address with the order', async () => {
    const s = deliveryStore();
    const res = await makeApp(s, { delivery: sandbox }).request('/v1/checkout', authed('u', { method: 'POST', body: JSON.stringify({
      pickupName: 'Sam', idempotencyKey: KEY, fulfilment: 'delivery', deliveryAddress: address, deliveryFeeCents: 1 /* ignored */,
    }) }));
    expect(res.status).toBe(201);
    const call = s.createPendingOrder.mock.calls[0]![0] as any;
    expect(call.fulfilment).toBe('delivery');
    expect(call.quote.deliveryFeeCents).toBeGreaterThan(499);
    expect(s.createDelivery).toHaveBeenCalledWith('o1', 'sandbox', expect.stringMatching(/^sbq_/), call.quote.deliveryFeeCents, expect.objectContaining({ suburb: 'New Farm' }));
  });

  it('accepts only signed partner webhooks', async () => {
    const applyDeliveryUpdate = vi.fn(async () => {});
    const app = makeApp({ applyDeliveryUpdate }, { delivery: sandbox });
    const body = JSON.stringify({ id: 'sbd_1', status: 'picked_up', courier_name: 'Alex', event_at: '2026-11-02T10:00:00Z' });
    const sig = createHmac('sha256', 'test-secret-1234567890').update(body).digest('hex');
    expect((await app.request('/webhooks/delivery/sandbox', { method: 'POST', body, headers: { 'x-sandbox-signature': 'f'.repeat(64) } })).status).toBe(400);
    expect((await app.request('/webhooks/delivery/other', { method: 'POST', body, headers: { 'x-sandbox-signature': sig } })).status).toBe(404);
    expect((await app.request('/webhooks/delivery/sandbox', { method: 'POST', body, headers: { 'x-sandbox-signature': sig } })).status).toBe(200);
    expect(applyDeliveryUpdate).toHaveBeenCalledWith('sandbox', expect.objectContaining({ externalId: 'sbd_1', status: 'picked_up', courierName: 'Alex' }));
  });

  it('refuses the sandbox delivery provider in production', async () => {
    const { loadEnv } = await import('../src/env');
    expect(() => loadEnv({ NODE_ENV: 'production', DELIVERY_PROVIDER: 'sandbox', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a'.repeat(30), SUPABASE_SERVICE_ROLE_KEY: 'b'.repeat(30) }))
      .toThrow(/not allowed in production/);
  });
});

describe('creator rewards', () => {
  it('only approved affiliates can connect payouts', async () => {
    const payments = { createConnectedAccount: vi.fn(async () => 'acct_c'), onboardingLink: vi.fn(async () => 'https://connect.stripe.com/x') };
    const store = (status: string) => ({
      creatorForPayouts: async () => ({ handle: 'bites', affiliateStatus: status, stripeAccountId: null, payoutsEnabled: false }),
      setCreatorStripeAccount: vi.fn(async () => {}),
    });
    expect((await makeApp(store('applied'), { payments: payments as any }).request('/v1/creators/me/payouts/onboarding', authed('c', { method: 'POST' }))).status).toBe(403);
    const ok = await makeApp(store('approved'), { payments: payments as any }).request('/v1/creators/me/payouts/onboarding', authed('c', { method: 'POST' }));
    expect(ok.status).toBe(200);
    expect(payments.createConnectedAccount).toHaveBeenCalledWith(expect.objectContaining({ kind: 'creator', restaurantName: '@bites' }));
  });

  it('daily job approves commissions, pays creators with an idempotency key and refreshes similarity', async () => {
    const transfer = vi.fn(async (_i: any) => ({ id: 'tr_1' }));
    const store = {
      expireUnpaidOrders: async () => [], claimRefunds: async () => [], deletionRequestsReady: async () => [],
      approveDueCommissions: vi.fn(async () => 3),
      creatorPayoutsDue: async () => [{ creatorId: 'c1', stripeAccountId: 'acct_c1', amountCents: 2500, commissionIds: ['b', 'a'] }],
      markCommissionsPaid: vi.fn(async () => 2),
      refreshSimilarity: vi.fn(async () => 120),
    } as unknown as DataStore;
    const r = await runBackgroundJobs(store, { transfer } as any, { runFraud: false, daily: true });
    expect(r).toMatchObject({ commissionsApproved: 3, creatorPayouts: 1, similarityPairs: 120 });
    expect(transfer).toHaveBeenCalledWith(expect.objectContaining({ destination: 'acct_c1', amountCents: 2500, idempotencyKey: expect.any(String) }));
    expect((store as any).markCommissionsPaid).toHaveBeenCalledWith(['b', 'a'], 'tr_1');
    // Same commissions => same idempotency key (no double payment on retry).
    await runBackgroundJobs(store, { transfer } as any, { runFraud: false, daily: true });
    expect(transfer.mock.calls[0]![0].idempotencyKey).toBe(transfer.mock.calls[1]![0].idempotencyKey);
  });
});

describe('collaborative ranking in the API', () => {
  it('uses similarities of videos the user craved, only with consent', async () => {
    const liked = candidate({ itemCuisine: 'thai' });
    const similar = candidate({ itemCuisine: 'mexican', restaurantId: 'r-sim' });
    const others = Array.from({ length: 6 }, () => candidate({ itemCuisine: 'mexican' }));
    const ctx = {
      signals: [{ kind: 'right_swipe' as const, at: new Date('2026-11-05T00:00:00Z'), videoId: liked.videoId, menuItemId: liked.menuItemId, item: candidateFeatures(liked) }],
      impressions: [], resetAt: null, preferences: EMPTY_PREFERENCES, weights: null,
      similarities: [{ videoId: liked.videoId, similarVideoId: similar.videoId, score: 0.9 }],
    };
    const store = { loadRankingContext: async () => ctx, recordImpressions: async () => {} } as unknown as DataStore;
    const now = new Date('2026-11-06T09:00:00Z');
    const on = await rulesRanker(store).rank({ userId: 'u', personalised: true, candidates: [...others, similar], limit: 7, now });
    expect(on.items[0]!.candidate.videoId).toBe(similar.videoId);
    expect(on.items[0]!.ranking!.reasons).toContain('Loved by people with your taste');
    const off = await rulesRanker(store).rank({ userId: 'u', personalised: false, candidates: [...others, similar], limit: 7, now });
    expect(off.items.find((i) => i.candidate.videoId === similar.videoId)!.ranking!.reasons).not.toContain('Loved by people with your taste');
  });
});
