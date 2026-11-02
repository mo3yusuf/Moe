import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { ApiError, forbidden, notFound } from '../lib/errors';

export const creatorRoutes = new Hono<AppEnv>();

creatorRoutes.get('/creators/me/earnings', async (c) => {
  const { store } = c.get('deps');
  const creator = await store.creatorForPayouts(c.get('user').id);
  if (!creator) throw notFound('Creator profile');
  const earnings = await store.creatorEarnings(c.get('user').id);
  return c.json({ affiliateStatus: creator.affiliateStatus, payoutsEnabled: creator.payoutsEnabled, payoutsConnected: !!creator.stripeAccountId, ...earnings });
});

/** Approved affiliates connect a Stripe Express account to receive commissions. */
creatorRoutes.post('/creators/me/payouts/onboarding', async (c) => {
  const { store, payments, webBaseUrl } = c.get('deps');
  if (!payments) throw new ApiError(503, 'payments_unavailable', 'Payouts are not configured');
  const userId = c.get('user').id;
  const creator = await store.creatorForPayouts(userId);
  if (!creator) throw notFound('Creator profile');
  if (creator.affiliateStatus !== 'approved') throw forbidden('Payouts are available once your affiliate application is approved');
  let accountId = creator.stripeAccountId;
  if (!accountId) {
    accountId = await payments.createConnectedAccount({ restaurantId: userId, restaurantName: `@${creator.handle}`, email: c.get('user').email, kind: 'creator' });
    await store.setCreatorStripeAccount(userId, accountId);
  }
  const base = `${webBaseUrl}/creator/payouts`;
  return c.json({ url: await payments.onboardingLink(accountId, `${base}?refresh=1`, `${base}?done=1`) });
});
