import { describe, expect, it } from 'vitest';
import { notificationEmail, receiptEmail, resendSender, runEmailJobs, type EmailMessage, type EmailOutbox, type OutboxNotification, type OutboxReceipt } from '../src/lib/email';
import { runBackgroundJobs } from '../src/lib/worker';

const links = { appUrl: 'https://app.example', dashboardUrl: 'https://dash.example' };
const note = (over: Partial<OutboxNotification> = {}): OutboxNotification => ({
  id: 'n1', userId: 'u1', email: 'owner@example.com', displayName: 'Sam', type: 'new_order', title: 'New order CR-1001',
  body: 'Pickup for Alex', data: { order_id: 'o1' }, restaurantId: 'r1', ...over,
});
const receipt: OutboxReceipt = {
  orderId: 'o1', email: 'alex@example.com', displayName: 'Alex <script>', orderNumber: 'CR-1001', restaurantName: 'Zaatar & Co',
  pickupName: 'Alex', placedAt: '2026-11-18T02:00:00Z', subtotalCents: 2400, serviceFeeCents: 99, deliveryFeeCents: 0, totalCents: 2499,
  gstCents: 227, currency: 'AUD', items: [{ name: 'Lamb wrap', quantity: 2, lineTotalCents: 2400, options: ['Extra garlic'], notes: 'no onion' }],
};

describe('email templates', () => {
  it('new-order alert links the restaurant to its orders screen', () => {
    const m = notificationEmail(note(), links)!;
    expect(m.to).toBe('owner@example.com');
    expect(m.subject).toContain('New order CR-1001');
    expect(m.html).toContain('https://dash.example/restaurant/r1/orders');
    expect(m.idempotencyKey).toBe('notification-n1');
  });

  it('customer status emails have clear headings and link to the order', () => {
    const ready = notificationEmail(note({ type: 'order_status', title: 'Order CR-1001 ready', data: { order_id: 'o1', status: 'ready' } }), links)!;
    expect(ready.subject).toBe('Your order is ready to collect');
    expect(ready.text).toContain('https://app.example/order/o1');
    const rejected = notificationEmail(note({ type: 'order_status', title: 'Order CR-1001 rejected', data: { order_id: 'o1', status: 'rejected' } }), links)!;
    expect(rejected.text).toContain('refund is on its way');
    const refund = notificationEmail(note({ type: 'refund', title: 'Refund processed', data: { order_id: 'o1', amount_cents: 1250 } }), links)!;
    expect(refund.text).toContain('$12.50');
  });

  it('other notification types are not emailed', () => {
    expect(notificationEmail(note({ type: 'moderation' }), links)).toBeNull();
  });

  it('receipt lists items, totals and GST, and escapes user text', () => {
    const m = receiptEmail(receipt, links);
    expect(m.subject).toBe('Your CRAVE order receipt — CR-1001');
    expect(m.html).toContain('2 × Lamb wrap');
    expect(m.html).toContain('$24.99');
    expect(m.html).toContain('Includes GST of');
    expect(m.html).toContain('Zaatar &amp; Co');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('Order receipt');
    expect(m.text).toContain('Extra garlic');
    expect(m.idempotencyKey).toBe('receipt-o1');
  });
});

function fakeOutbox(notes: OutboxNotification[], receipts: OutboxReceipt[]) {
  const sent = { notes: [] as string[], receipts: [] as string[] };
  const outbox: EmailOutbox = {
    claimNotifications: async () => notes,
    notificationsSent: async (ids) => { sent.notes.push(...ids); },
    claimReceipts: async () => receipts,
    receiptsSent: async (ids) => { sent.receipts.push(...ids); },
  };
  return { outbox, sent };
}

describe('email outbox run', () => {
  it('sends, marks sent, and leaves failures for retry', async () => {
    const { outbox, sent } = fakeOutbox([note({ id: 'a' }), note({ id: 'b', email: 'fail@example.com' }), note({ id: 'c', type: 'moderation' })], [receipt]);
    const delivered: EmailMessage[] = [];
    const sender = { send: async (m: EmailMessage) => { if (m.to === 'fail@example.com') throw new Error('boom'); delivered.push(m); } };
    const r = await runEmailJobs(outbox, sender, links);
    expect(r).toEqual({ sent: 2, failed: 1, skipped: 1 });
    expect(sent.notes.sort()).toEqual(['a', 'c']); // b stays unsent → retried after the lease
    expect(sent.receipts).toEqual(['o1']);
    expect(delivered.map((m) => m.idempotencyKey)).toEqual(['notification-a', 'receipt-o1']);
  });

  it('an email outage never breaks the other background jobs', async () => {
    const store = new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : async () => []) }) as any;
    const outbox: EmailOutbox = { claimNotifications: async () => { throw new Error('db down'); }, notificationsSent: async () => {}, claimReceipts: async () => [], receiptsSent: async () => {} };
    const logs: string[] = [];
    const r = await runBackgroundJobs(store, null, { runFraud: false, email: { outbox, sender: { send: async () => {} }, links }, log: (m) => logs.push(m) });
    expect(r.emails).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(logs).toContain('email jobs failed');
  });
});

describe('resend sender', () => {
  it('posts to Resend with the idempotency key and surfaces errors', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = resendSender({ apiKey: 're_test', from: 'CRAVE <orders@example.com>', fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as any });
    await ok.send({ to: 'a@example.com', subject: 'Hi', html: '<p>x</p>', text: 'x', idempotencyKey: 'k1' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('k1');
    expect(headers.Authorization).toBe('Bearer re_test');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ from: 'CRAVE <orders@example.com>', to: ['a@example.com'] });
    const bad = resendSender({ apiKey: 're_test', from: 'x@example.com', fetchImpl: (async () => new Response('invalid from', { status: 422 })) as any });
    await expect(bad.send({ to: 'a@example.com', subject: 'Hi', html: '', text: '', idempotencyKey: 'k2' })).rejects.toThrow('Resend 422');
  });
});
