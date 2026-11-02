import { Hono } from 'hono';
import type Stripe from 'stripe';
import type { AppEnv } from '../app';
import type { DataStore } from '../lib/store';

/**
 * Stripe webhooks: the ONLY place a card payment is treated as successful. Signature verified against
 * the raw body; each event processed at most once (webhook_events); failures return 500 so Stripe retries.
 */
export const webhookRoutes = new Hono<AppEnv>();

webhookRoutes.post('/stripe', async (c) => {
  const { payments, store } = c.get('deps');
  if (!payments) return c.json({ error: 'payments not configured' }, 503);
  const raw = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await payments.verifyWebhook(raw, c.req.header('stripe-signature') ?? '');
  } catch {
    return c.json({ error: 'invalid signature' }, 400);
  }
  if (!(await store.beginWebhook(event.id, event.type, event))) return c.json({ received: true, duplicate: true });
  try {
    await handleStripeEvent(store, event);
    await store.finishWebhook(event.id, null);
    return c.json({ received: true });
  } catch (e) {
    await store.finishWebhook(event.id, e instanceof Error ? e.message.slice(0, 500) : 'error');
    console.error('[crave-api] webhook failed', event.type, e);
    return c.json({ error: 'processing failed' }, 500);
  }
});

const refundStatus = (s: string | null | undefined): 'pending' | 'succeeded' | 'failed' =>
  s === 'succeeded' ? 'succeeded' : s === 'failed' || s === 'canceled' ? 'failed' : 'pending';

export async function handleStripeEvent(store: DataStore, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const orderId = pi.metadata?.order_id;
      if (!orderId) return; // not a CRAVE order intent
      await store.confirmPayment(orderId, 'stripe', pi.id, pi.amount_received, pi.application_fee_amount ?? 0, !event.livemode);
      return;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      await store.markPaymentFailed(pi.id, pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? 'payment_failed');
      return;
    }
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed': {
      const r = event.data.object;
      await store.markRefundResult(r.metadata?.crave_refund_id ?? null, r.id, refundStatus(r.status), r.failure_reason ?? undefined);
      return;
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed': {
      const d = event.data.object;
      const intentId = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id;
      if (!intentId) return;
      const due = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null;
      await store.recordDispute(intentId, d.id, d.amount, d.reason, d.status, due);
      return;
    }
    case 'account.updated': {
      const a = event.data.object;
      await store.setRestaurantStripeStatus(a.id, !!a.charges_enabled, !!a.payouts_enabled);
      return;
    }
    case 'payout.created':
    case 'payout.updated':
    case 'payout.paid':
    case 'payout.failed': {
      if (!event.account) return; // platform payouts are not restaurant payouts
      const p = event.data.object;
      await store.upsertPayout(event.account, p.id, p.amount, p.currency, p.status, p.arrival_date ? new Date(p.arrival_date * 1000).toISOString().slice(0, 10) : null);
      return;
    }
    default:
      return; // ignore other event types
  }
}
