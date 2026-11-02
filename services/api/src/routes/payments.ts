import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors';

export const paymentRoutes = new Hono<AppEnv>();

/** Restaurant owners connect a Stripe Express account to receive payouts. */
paymentRoutes.post('/restaurants/:id/payments/onboarding', async (c) => {
  const { store, payments, webBaseUrl } = c.get('deps');
  if (!payments) throw new ApiError(503, 'payments_unavailable', 'Payments are not configured');
  const id = z.uuid().safeParse(c.req.param('id'));
  if (!id.success) throw notFound('Restaurant');
  if (!(await store.isRestaurantOwner(c.get('user').id, id.data))) throw forbidden('Only the restaurant owner can set up payouts');
  const r = await store.restaurantPayments(id.data);
  if (!r) throw notFound('Restaurant');
  let accountId = r.stripeAccountId;
  if (!accountId) {
    accountId = await payments.createConnectedAccount({ restaurantId: id.data, restaurantName: r.name, email: c.get('user').email });
    await store.setRestaurantStripeAccount(id.data, accountId);
  }
  const base = `${webBaseUrl}/restaurant/${id.data}/payouts`;
  return c.json({ url: await payments.onboardingLink(accountId, `${base}?refresh=1`, `${base}?done=1`) });
});

paymentRoutes.post('/restaurants/:id/payments/dashboard', async (c) => {
  const { store, payments } = c.get('deps');
  const id = z.uuid().safeParse(c.req.param('id'));
  if (!payments || !id.success) throw notFound('Restaurant');
  if (!(await store.isRestaurantOwner(c.get('user').id, id.data))) throw forbidden('Only the restaurant owner can open the payouts dashboard');
  const r = await store.restaurantPayments(id.data);
  if (!r?.stripeAccountId) throw badRequest('Payouts are not set up yet');
  return c.json({ url: await payments.dashboardLink(r.stripeAccountId) });
});

/** Admin: compare Stripe's succeeded payments with CRAVE's records for one Brisbane day. */
export const adminPaymentRoutes = new Hono<AppEnv>();
adminPaymentRoutes.use('*', async (c, next) => {
  if (!(await c.get('deps').store.isAdmin(c.get('user').id))) throw forbidden('Administrators only');
  await next();
});

adminPaymentRoutes.get('/reconciliation', async (c) => {
  const { store, payments } = c.get('deps');
  if (!payments) throw new ApiError(503, 'payments_unavailable', 'Payments are not configured');
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(c.req.query('date'));
  if (!date.success) throw badRequest('Use date=YYYY-MM-DD');
  const from = new Date(`${date.data}T00:00:00+10:00`); // Brisbane (AEST, no DST)
  const to = new Date(from.getTime() + 86_400_000);
  const [stripe, ours] = await Promise.all([
    payments.listSucceededIntents(Math.floor(from.getTime() / 1000), Math.floor(to.getTime() / 1000)),
    // Look a day either side for our records so intents created near midnight still match.
    store.paymentsForReconciliation(new Date(from.getTime() - 86_400_000), new Date(to.getTime() + 86_400_000)),
  ]);
  return c.json(reconcile(stripe, ours));
});

export function reconcile(
  stripe: { id: string; amount: number; orderId: string | null }[],
  ours: { intentId: string; orderNumber: string; amountCents: number; status: string }[],
) {
  const byId = new Map(ours.map((p) => [p.intentId, p]));
  const issues: { intentId: string; problem: string; stripeAmount?: number; ourAmount?: number; orderNumber?: string }[] = [];
  let matchedCents = 0;
  for (const s of stripe) {
    const o = byId.get(s.id);
    if (!o) issues.push({ intentId: s.id, problem: 'Paid in Stripe but missing in CRAVE', stripeAmount: s.amount });
    else if (o.amountCents !== s.amount) issues.push({ intentId: s.id, problem: 'Amount mismatch', stripeAmount: s.amount, ourAmount: o.amountCents, orderNumber: o.orderNumber });
    else if (!['succeeded', 'refunded', 'partially_refunded'].includes(o.status)) issues.push({ intentId: s.id, problem: `Paid in Stripe but CRAVE status is ${o.status} (webhook missed?)`, orderNumber: o.orderNumber });
    else matchedCents += s.amount;
  }
  const stripeIds = new Set(stripe.map((s) => s.id));
  for (const o of ours) {
    if (o.status === 'succeeded' && !stripeIds.has(o.intentId)) {
      issues.push({ intentId: o.intentId, problem: 'Succeeded in CRAVE but not in Stripe for this day (check date boundary)', ourAmount: o.amountCents, orderNumber: o.orderNumber });
    }
  }
  return { stripeCount: stripe.length, stripeTotalCents: stripe.reduce((a, s) => a + s.amount, 0), matchedCents, issues };
}
