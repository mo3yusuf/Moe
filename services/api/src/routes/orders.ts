import { quoteBasket, validateSelection, type Quote } from '@crave/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { BasketRow, DataStore } from '../lib/store';

const Uuid = z.uuid();
const AddItem = z.object({
  menuItemId: Uuid,
  quantity: z.number().int().min(1).max(50).default(1),
  optionIds: z.array(Uuid).max(30).default([]),
  notes: z.string().trim().max(200).nullish(),
  sourceVideoId: Uuid.nullish(),
  replaceBasket: z.boolean().default(false),
});
const Checkout = z.object({
  pickupName: z.string().trim().min(1).max(40),
  note: z.string().trim().max(300).nullish(),
  idempotencyKey: Uuid,
  scheduledFor: z.iso.datetime().nullish(),
});

interface PricedBasket {
  basket: BasketRow;
  restaurantName: string;
  lines: { id: string; menuItemId: string; name: string; quantity: number; notes: string | null; options: string[]; unitPriceCents: number | null; issue: string | null }[];
  quote: Quote | null;
}

/** Re-prices a basket from current database prices. Lines that became invalid are flagged, not dropped. */
async function priceBasket(store: DataStore, basket: BasketRow): Promise<PricedBasket> {
  const defs = await store.itemDefs([...new Set(basket.items.map((i) => i.menuItemId))]);
  const valid: Parameters<typeof quoteBasket>[0] = [];
  let restaurantName = '';
  let commission = 1000;
  const lines = basket.items.map((i) => {
    const def = defs.get(i.menuItemId);
    if (!def || def.restaurantId !== basket.restaurantId) return { id: i.id, menuItemId: i.menuItemId, name: 'Unavailable item', quantity: i.quantity, notes: i.notes, options: [], unitPriceCents: null, issue: 'No longer on the menu' };
    restaurantName = def.restaurantName;
    commission = def.commissionRateBps;
    const errors = validateSelection(def, i.optionIds);
    const chosen = def.optionGroups.flatMap((g) => g.options).filter((o) => i.optionIds.includes(o.id));
    if (!errors.length) valid.push({ item: def, optionIds: i.optionIds, quantity: i.quantity, notes: i.notes, sourceVideoId: i.sourceVideoId });
    return {
      id: i.id, menuItemId: i.menuItemId, name: def.name, quantity: i.quantity, notes: i.notes, options: chosen.map((o) => o.name),
      unitPriceCents: def.priceCents + chosen.reduce((a, o) => a + o.priceDeltaCents, 0), issue: errors[0]?.message ?? null,
    };
  });
  let quote: Quote | null = null;
  if (valid.length) quote = quoteBasket(valid, { commissionRateBps: commission, serviceFee: await store.serviceFeeConfig() });
  return { basket, restaurantName, lines, quote };
}

export const orderRoutes = new Hono<AppEnv>();

orderRoutes.get('/basket', async (c) => {
  const { store } = c.get('deps');
  const basket = await store.getBasket(c.get('user').id);
  if (!basket || !basket.items.length) return c.json({ basket: null });
  const priced = await priceBasket(store, basket);
  const loc = await store.locationStatus(basket.locationId);
  return c.json({
    basket: { id: basket.id, restaurantId: basket.restaurantId, restaurantName: priced.restaurantName, lines: priced.lines },
    quote: priced.quote,
    location: loc,
    canCheckout: !!priced.quote && priced.lines.every((l) => !l.issue) && !!loc?.acceptingOrders && !!loc.pickupEnabled && loc.isOpen,
  });
});

orderRoutes.post('/basket/items', async (c) => {
  const parsed = AddItem.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid item');
  const { store } = c.get('deps');
  const userId = c.get('user').id;
  const input = parsed.data;
  const def = (await store.itemDefs([input.menuItemId])).get(input.menuItemId);
  if (!def || !def.locationId) throw notFound('Menu item');
  const errors = validateSelection(def, input.optionIds);
  if (errors.length) throw new ApiError(422, 'invalid_selection', errors.map((e) => e.message).join('. '));

  let basket = await store.getBasket(userId);
  if (basket && basket.restaurantId !== def.restaurantId) {
    if (!input.replaceBasket) throw conflict('Your basket has items from another restaurant. Start a new basket?', 'basket_conflict');
    await store.abandonBasket(userId);
    basket = null;
  }
  if (!basket) basket = await store.createBasket(userId, def.restaurantId, def.locationId);
  await store.addBasketItem(basket.id, {
    menuItemId: def.id, quantity: input.quantity, optionIds: input.optionIds, notes: input.notes ?? null, sourceVideoId: input.sourceVideoId ?? null,
  });
  return c.json({ ok: true, basketId: basket.id }, 201);
});

orderRoutes.patch('/basket/items/:itemId', async (c) => {
  const body = z.object({ quantity: z.number().int().min(1).max(50) }).safeParse(await c.req.json().catch(() => null));
  const itemId = Uuid.safeParse(c.req.param('itemId'));
  if (!body.success || !itemId.success) throw badRequest('Invalid quantity');
  const basket = await c.get('deps').store.getBasket(c.get('user').id);
  if (!basket || !(await c.get('deps').store.updateBasketItem(basket.id, itemId.data, body.data.quantity))) throw notFound('Basket item');
  return c.json({ ok: true });
});

orderRoutes.delete('/basket/items/:itemId', async (c) => {
  const itemId = Uuid.safeParse(c.req.param('itemId'));
  if (!itemId.success) throw notFound('Basket item');
  const basket = await c.get('deps').store.getBasket(c.get('user').id);
  if (!basket || !(await c.get('deps').store.removeBasketItem(basket.id, itemId.data))) throw notFound('Basket item');
  return c.json({ ok: true });
});

orderRoutes.delete('/basket', async (c) => {
  await c.get('deps').store.abandonBasket(c.get('user').id);
  return c.json({ ok: true });
});

orderRoutes.post('/checkout', async (c) => {
  const { store, paymentsMode } = c.get('deps');
  if (paymentsMode === 'disabled') throw new ApiError(503, 'checkout_disabled', 'Ordering is not available yet');
  const parsed = Checkout.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Enter a pickup name');
  const userId = c.get('user').id;
  const basket = await store.getBasket(userId);
  if (!basket || !basket.items.length) throw badRequest('Your basket is empty', 'empty_basket');

  const priced = await priceBasket(store, basket);
  const issue = priced.lines.find((l) => l.issue);
  if (issue || !priced.quote) throw new ApiError(422, 'basket_changed', issue ? `${issue.name}: ${issue.issue}` : 'Your basket needs updating');

  // Never accept orders the restaurant can't fulfil.
  const scheduledFor = parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null;
  const now = c.get('deps').now?.() ?? new Date();
  if (scheduledFor && (scheduledFor.getTime() < now.getTime() + 10 * 60_000 || scheduledFor.getTime() > now.getTime() + 7 * 86_400_000)) {
    throw badRequest('Pickup time must be between 10 minutes and 7 days from now');
  }
  const defs = await store.itemDefs([basket.items[0]!.menuItemId]);
  const acceptsAdvance = defs.get(basket.items[0]!.menuItemId)?.acceptsAdvanceOrders ?? false;
  if (scheduledFor && !acceptsAdvance) throw badRequest('This restaurant does not take advance orders');
  const loc = await store.locationStatus(basket.locationId, scheduledFor ?? undefined);
  if (!loc?.pickupEnabled) throw new ApiError(422, 'pickup_unavailable', 'Pickup is not available at this restaurant');
  if (!loc.acceptingOrders) throw new ApiError(422, 'not_accepting', 'The restaurant is not taking orders right now');
  if (!loc.isOpen) throw new ApiError(422, 'restaurant_closed', scheduledFor ? 'The restaurant is closed at that time' : 'The restaurant is closed right now');

  // Card payments go to the restaurant's connected Stripe account; it must be fully onboarded.
  const { payments, stripeOnBehalfOf } = c.get('deps');
  let stripeAccount: string | null = null;
  if (paymentsMode === 'stripe') {
    const rp = await store.restaurantPayments(basket.restaurantId);
    if (!payments || !rp?.stripeAccountId || !rp.payoutsEnabled) {
      throw new ApiError(422, 'restaurant_payments_not_ready', 'This restaurant can’t take card payments yet');
    }
    stripeAccount = rp.stripeAccountId;
  }

  const sourceVideoId = basket.items.find((i) => i.sourceVideoId)?.sourceVideoId ?? null;
  const order = await store.createPendingOrder({
    userId, restaurantId: basket.restaurantId, locationId: basket.locationId, pickupName: parsed.data.pickupName,
    note: parsed.data.note ?? null, scheduledFor: scheduledFor?.toISOString() ?? null, sourceVideoId,
    quote: priced.quote, idempotencyKey: parsed.data.idempotencyKey,
  });

  if (paymentsMode === 'simulated') {
    return c.json({ order, quote: priced.quote, payment: { mode: 'simulated', notice: 'TEST MODE — no real payment is taken.' } }, 201);
  }

  // CRAVE's application fee = commission + service fee; the restaurant receives its net via the transfer.
  const applicationFee = priced.quote.totalCents - priced.quote.restaurantNetCents;
  const intent = await payments!.createIntent({
    orderId: order.id, orderNumber: order.orderNumber, amountCents: order.totalCents, applicationFeeCents: applicationFee,
    currency: priced.quote.currency, destinationAccount: stripeAccount!, onBehalfOf: stripeOnBehalfOf ?? true,
  });
  await store.recordPaymentIntent(order.id, intent.id, order.totalCents, applicationFee, payments!.testMode);
  return c.json({
    order, quote: priced.quote,
    payment: { mode: 'stripe', clientSecret: intent.clientSecret, testMode: payments!.testMode },
  }, 201);
});

/** DEVELOPMENT ONLY. Stands in for the payment provider until Stripe is integrated (Phase 7). */
orderRoutes.post('/orders/:id/pay-simulated', async (c) => {
  const { store, paymentsMode } = c.get('deps');
  if (paymentsMode !== 'simulated') throw forbidden('Simulated payments are disabled');
  const id = Uuid.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('Order');
  const order = await store.getOrder(c.get('user').id, id.data);
  if (!order) throw notFound('Order');
  if (order.status !== 'pending_payment') return c.json({ ok: true, status: order.status });
  // Application fee (platform revenue) is informational for simulated payments; Stripe computes it in Phase 7.
  await store.confirmPayment(order.id, 'simulated', `sim_${crypto.randomUUID()}`, order.totalCents, order.totalCents - order.subtotalCents, true);
  return c.json({ ok: true, status: 'placed' });
});

orderRoutes.get('/orders', async (c) => c.json({ items: await c.get('deps').store.listOrders(c.get('user').id) }));

orderRoutes.get('/orders/:id', async (c) => {
  const id = Uuid.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('Order');
  const order = await c.get('deps').store.getOrder(c.get('user').id, id.data);
  if (!order) throw notFound('Order');
  return c.json(order);
});

