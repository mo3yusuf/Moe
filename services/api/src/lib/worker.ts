import type { PaymentProvider } from './payments';
import type { DataStore } from './store';
import type { DeliveryProvider } from './delivery';

export interface WorkerResult {
  expired: number; refunds: { succeeded: number; pending: number; failed: number }; deletions: number; fraudFlags: number;
  commissionsApproved: number; creatorPayouts: number; dispatched: number; similarityPairs: number;
}

/**
 * Background jobs, run on an interval by the API process (single instance for the pilot; move to a
 * scheduled job runner when scaling out). Every step is idempotent and safe to re-run.
 */
export async function runBackgroundJobs(store: DataStore, payments: PaymentProvider | null, opts: { runFraud: boolean; daily?: boolean; delivery?: DeliveryProvider | null; log?: (m: string, e?: unknown) => void } = { runFraud: false }): Promise<WorkerResult> {
  const log = opts.log ?? (() => {});
  const result: WorkerResult = { expired: 0, refunds: { succeeded: 0, pending: 0, failed: 0 }, deletions: 0, fraudFlags: 0, commissionsApproved: 0, creatorPayouts: 0, dispatched: 0, similarityPairs: 0 };

  // 1. Cancel unpaid orders (and their Stripe intents) after 30 minutes.
  for (const e of await store.expireUnpaidOrders(30)) {
    result.expired += 1;
    if (e.intentId && payments) await payments.cancelIntent(e.intentId).catch((err) => log('cancel intent failed', err));
  }

  // 2. Execute approved / automatic refunds.
  for (const r of await store.claimRefunds(20)) {
    try {
      if (r.provider === 'simulated') {
        // Test-mode orders: no money moved, so the refund completes immediately.
        await store.markRefundResult(r.refundId, `sim_re_${r.refundId}`, 'succeeded');
        result.refunds.succeeded += 1;
      } else if (r.provider === 'stripe' && payments && r.intentId) {
        const res = await payments.refund({ intentId: r.intentId, amountCents: r.amountCents, idempotencyKey: r.refundId, full: r.full });
        await store.markRefundResult(r.refundId, res.id, res.status);
        result.refunds[res.status] += 1;
      } else {
        log(`refund ${r.refundId} skipped: payments not configured`);
      }
    } catch (err) {
      log(`refund ${r.refundId} failed`, err);
      await store.markRefundResult(r.refundId, null, 'failed', err instanceof Error ? err.message.slice(0, 200) : 'error');
      result.refunds.failed += 1;
    }
  }

  // 3. Account deletions whose orders are all finished.
  for (const d of await store.deletionRequestsReady(10)) {
    try { await store.deleteUserAccount(d.requestId, d.userId); result.deletions += 1; } catch (err) { log(`deletion ${d.requestId} failed`, err); }
  }

  // 4. Fraud rules (hourly).
  if (opts.runFraud) result.fraudFlags = await store.runFraudRules();

  // 5. Dispatch delivery orders to the partner once the restaurant has accepted them.
  if (opts.delivery) {
    for (const d of await store.deliveriesToDispatch(10)) {
      if (d.provider !== opts.delivery.name) continue;
      try {
        const res = await opts.delivery.create({
          quoteId: d.quoteId, orderNumber: d.orderNumber, orderValueCents: d.totalCents, dropoff: d.dropoff,
          pickup: { address: d.pickupAddress, lat: d.pickupLat, lng: d.pickupLng, phone: d.pickupPhone, name: d.restaurantName, readyInMinutes: d.prepMinutes },
        });
        await store.markDeliveryRequested(d.deliveryId, res.externalId, res.trackingUrl);
        result.dispatched += 1;
      } catch (err) {
        log(`delivery dispatch ${d.deliveryId} failed`, err);
        await store.markDeliveryFailed(d.deliveryId, err instanceof Error ? err.message.slice(0, 200) : 'error');
      }
    }
  }

  // 6. Daily: approve creator commissions past the 7-day refund window, pay creators, refresh "similar videos".
  if (opts.daily) {
    result.commissionsApproved = await store.approveDueCommissions(7);
    if (payments) {
      for (const p of await store.creatorPayoutsDue(1000)) {
        try {
          // Idempotency key derived from the exact commissions being paid: retries can't double-pay.
          const key = `${p.creatorId}-${[...p.commissionIds].sort().join(',')}`.slice(0, 200);
          const t = await payments.transfer({ destination: p.stripeAccountId, amountCents: p.amountCents, idempotencyKey: hashKey(key), description: 'CRAVE creator commissions' });
          await store.markCommissionsPaid(p.commissionIds, t.id);
          result.creatorPayouts += 1;
        } catch (err) { log(`creator payout ${p.creatorId} failed`, err); }
      }
    }
    result.similarityPairs = await store.refreshSimilarity();
  }
  return result;
}

function hashKey(s: string): string {
  // Short stable key (FNV-1a) — Stripe idempotency keys are limited to 255 chars.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}-${s.length}-${s.slice(0, 36)}`;
}
