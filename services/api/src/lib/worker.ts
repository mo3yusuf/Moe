import type { PaymentProvider } from './payments';
import type { DataStore } from './store';

export interface WorkerResult { expired: number; refunds: { succeeded: number; pending: number; failed: number }; deletions: number; fraudFlags: number }

/**
 * Background jobs, run on an interval by the API process (single instance for the pilot; move to a
 * scheduled job runner when scaling out). Every step is idempotent and safe to re-run.
 */
export async function runBackgroundJobs(store: DataStore, payments: PaymentProvider | null, opts: { runFraud: boolean; log?: (m: string, e?: unknown) => void } = { runFraud: false }): Promise<WorkerResult> {
  const log = opts.log ?? (() => {});
  const result: WorkerResult = { expired: 0, refunds: { succeeded: 0, pending: 0, failed: 0 }, deletions: 0, fraudFlags: 0 };

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
  return result;
}
