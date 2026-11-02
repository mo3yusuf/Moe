import { describe, expect, it, vi } from 'vitest';
import type { BasketRow, DataStore, LocationStatus, OrderableItemDef } from '../src/lib/store';
import { authed, makeApp } from './helpers';

const R1 = 'aaaaaaaa-0000-4000-8000-000000000001', R2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const L1 = 'bbbbbbbb-0000-4000-8000-000000000001', L2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const BURGER = 'cccccccc-0000-4000-8000-000000000001', SUSHI = 'cccccccc-0000-4000-8000-000000000002';
const DOUBLE = 'dddddddd-0000-4000-8000-000000000001', TRIPLE = 'dddddddd-0000-4000-8000-000000000002';
const VIDEO = 'eeeeeeee-0000-4000-8000-000000000001';
const KEY = 'ffffffff-0000-4000-8000-000000000001';

function fakeStore(over: { location?: Partial<LocationStatus>; burgerAvailable?: boolean; advance?: boolean } = {}) {
  const defs: Record<string, OrderableItemDef> = {
    [BURGER]: {
      id: BURGER, name: 'Smash', priceCents: 1690, isAvailable: over.burgerAvailable ?? true, gstApplicable: true,
      restaurantId: R1, restaurantName: 'Valley Smash', commissionRateBps: 1000, locationId: L1, acceptsAdvanceOrders: over.advance ?? false,
      optionGroups: [{ id: 'g', name: 'Patties', minSelect: 1, maxSelect: 1, options: [
        { id: DOUBLE, name: 'Double', priceDeltaCents: 0, isAvailable: true }, { id: TRIPLE, name: 'Triple', priceDeltaCents: 450, isAvailable: true }] }],
    },
    [SUSHI]: { id: SUSHI, name: 'Nigiri', priceCents: 2200, isAvailable: true, gstApplicable: true, restaurantId: R2, restaurantName: 'Kurilpa',
      commissionRateBps: 800, locationId: L2, acceptsAdvanceOrders: false, optionGroups: [] },
  };
  let basket: BasketRow | null = null;
  let n = 0;
  const createPendingOrder = vi.fn(async (i: any) => ({ id: 'order-1', orderNumber: 'CR-1000', status: 'pending_payment', totalCents: i.quote.totalCents }));
  const confirmPayment = vi.fn(async () => {});
  const store: Partial<DataStore> = {
    itemDefs: async (ids) => new Map(ids.filter((id) => defs[id]).map((id) => [id, defs[id]!])),
    locationStatus: async () => ({ isOpen: true, acceptingOrders: true, pickupEnabled: true, prepTimeMinutes: 15, ...over.location }),
    serviceFeeConfig: async () => ({ percentBps: 0, fixedCents: 99, minCents: 99, maxCents: 299 }),
    getBasket: async () => basket,
    createBasket: async (_u, restaurantId, locationId) => (basket = { id: `basket-${++n}`, restaurantId, locationId, items: [] }),
    abandonBasket: async () => { basket = null; },
    addBasketItem: async (_b, i) => { basket!.items.push({ id: `item-${++n}`, ...i }); },
    createPendingOrder,
    confirmPayment,
    getOrder: async (userId, id) => (userId === 'buyer' && id === '99999999-0000-4000-8000-000000000001'
      ? { id, status: 'pending_payment', totalCents: 1789, subtotalCents: 1690 } as any : null),
  };
  return { store, createPendingOrder, confirmPayment, get basket() { return basket; } };
}

const post = (path: string, body: unknown, user = 'buyer') => [path, authed(user, { method: 'POST', body: JSON.stringify(body) })] as const;

describe('basket', () => {
  it('rejects invalid customisations', async () => {
    const f = fakeStore();
    const res = await makeApp(f.store).request(...post('/v1/basket/items', { menuItemId: BURGER, optionIds: [] }));
    expect(res.status).toBe(422);
    expect((await res.json() as any).error.message).toMatch(/Choose one for Patties/);
  });

  it('prices on the server and ignores any client-sent prices', async () => {
    const f = fakeStore();
    const app = makeApp(f.store);
    expect((await app.request(...post('/v1/basket/items', { menuItemId: BURGER, optionIds: [TRIPLE], quantity: 2, priceCents: 1, sourceVideoId: VIDEO }))).status).toBe(201);
    const body = await (await app.request('/v1/basket', authed('buyer'))).json() as any;
    expect(body.quote.subtotalCents).toBe(2140 * 2);
    expect(body.quote.totalCents).toBe(4280 + 99);
    expect(body.canCheckout).toBe(true);
  });

  it('one restaurant per basket unless the customer chooses to start again', async () => {
    const f = fakeStore();
    const app = makeApp(f.store);
    await app.request(...post('/v1/basket/items', { menuItemId: BURGER, optionIds: [DOUBLE] }));
    const clash = await app.request(...post('/v1/basket/items', { menuItemId: SUSHI }));
    expect(clash.status).toBe(409);
    expect((await clash.json() as any).error.code).toBe('basket_conflict');
    expect((await app.request(...post('/v1/basket/items', { menuItemId: SUSHI, replaceBasket: true }))).status).toBe(201);
    expect(f.basket!.restaurantId).toBe(R2);
    expect(f.basket!.items).toHaveLength(1);
  });

  it('flags items that sold out after being added and blocks checkout', async () => {
    const f = fakeStore();
    const app = makeApp(f.store);
    await app.request(...post('/v1/basket/items', { menuItemId: BURGER, optionIds: [DOUBLE] }));
    const soldOut = fakeStore({ burgerAvailable: false });
    (soldOut.store as any).getBasket = f.store.getBasket;
    const body = await (await makeApp(soldOut.store).request('/v1/basket', authed('buyer'))).json() as any;
    expect(body.basket.lines[0].issue).toMatch(/sold out/);
    expect(body.canCheckout).toBe(false);
    const res = await makeApp(soldOut.store).request(...post('/v1/checkout', { pickupName: 'Sam', idempotencyKey: KEY }));
    expect(res.status).toBe(422);
  });
});

describe('checkout', () => {
  async function withBasket(over: Parameters<typeof fakeStore>[0] = {}, mode: 'simulated' | 'disabled' = 'simulated') {
    const f = fakeStore(over);
    const app = makeApp(f.store, { paymentsMode: mode });
    await app.request(...post('/v1/basket/items', { menuItemId: BURGER, optionIds: [DOUBLE], sourceVideoId: VIDEO }));
    return { f, app };
  }

  it('creates a pending order from the server quote with the idempotency key and video attribution', async () => {
    const { f, app } = await withBasket();
    const res = await app.request(...post('/v1/checkout', { pickupName: 'Sam', note: 'No onions', idempotencyKey: KEY }));
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.payment.mode).toBe('simulated');
    expect(body.payment.notice).toMatch(/no real payment/i);
    expect(f.createPendingOrder).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'buyer', restaurantId: R1, locationId: L1, idempotencyKey: KEY, sourceVideoId: VIDEO,
      quote: expect.objectContaining({ subtotalCents: 1690, totalCents: 1789, commissionCents: 169 }),
    }));
  });

  it('never accepts orders for closed, paused or pickup-disabled restaurants', async () => {
    for (const [location, code] of [[{ isOpen: false }, 'restaurant_closed'], [{ acceptingOrders: false }, 'not_accepting'], [{ pickupEnabled: false }, 'pickup_unavailable']] as const) {
      const { f, app } = await withBasket({ location });
      const res = await app.request(...post('/v1/checkout', { pickupName: 'Sam', idempotencyKey: KEY }));
      expect(res.status).toBe(422);
      expect((await res.json() as any).error.code).toBe(code);
      expect(f.createPendingOrder).not.toHaveBeenCalled();
    }
  });

  it('advance orders only where the restaurant accepts them', async () => {
    const later = new Date(Date.now() + 3 * 3600_000).toISOString();
    const { app } = await withBasket({ advance: false });
    expect((await app.request(...post('/v1/checkout', { pickupName: 'Sam', idempotencyKey: KEY, scheduledFor: later }))).status).toBe(400);
    const ok = await withBasket({ advance: true, location: { isOpen: true } });
    expect((await ok.app.request(...post('/v1/checkout', { pickupName: 'Sam', idempotencyKey: KEY, scheduledFor: later }))).status).toBe(201);
  });

  it('is unavailable when payments are disabled', async () => {
    const { app } = await withBasket({}, 'disabled');
    expect((await app.request(...post('/v1/checkout', { pickupName: 'Sam', idempotencyKey: KEY }))).status).toBe(503);
  });
});

describe('simulated payment', () => {
  const ORDER = '99999999-0000-4000-8000-000000000001';
  it('confirms the exact order total, own orders only, and only in simulated mode', async () => {
    const f = fakeStore();
    expect((await makeApp(f.store).request(...post(`/v1/orders/${ORDER}/pay-simulated`, {}, 'someone-else'))).status).toBe(404);
    expect((await makeApp(f.store, { paymentsMode: 'stripe' }).request(...post(`/v1/orders/${ORDER}/pay-simulated`, {}))).status).toBe(403);
    const ok = await makeApp(f.store).request(...post(`/v1/orders/${ORDER}/pay-simulated`, {}));
    expect(ok.status).toBe(200);
    expect(f.confirmPayment).toHaveBeenCalledWith(ORDER, 'simulated', expect.stringMatching(/^sim_/), 1789, 99, true);
  });

  it('refuses to start in production with simulated payments', async () => {
    const { loadEnv } = await import('../src/env');
    expect(() => loadEnv({ NODE_ENV: 'production', PAYMENTS_MODE: 'simulated', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a'.repeat(30), SUPABASE_SERVICE_ROLE_KEY: 'b'.repeat(30) }))
      .toThrow(/not allowed in production/);
  });
});
