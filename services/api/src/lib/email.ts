import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Transactional email (Resend). The database keeps an outbox (see migration 023): the worker claims
 * new-order alerts, customer status updates, refunds and paid orders needing a receipt, sends them,
 * then marks them sent. A crashed send is retried after a 5-minute lease (max 5 attempts), and the
 * Resend Idempotency-Key stops a retry from delivering the same email twice.
 */

export interface EmailMessage { to: string; subject: string; html: string; text: string; idempotencyKey: string }
export interface EmailSender { send(m: EmailMessage): Promise<void> }

export interface OutboxNotification { id: string; userId: string; email: string; displayName: string; type: string; title: string; body: string | null; data: Record<string, unknown>; restaurantId: string | null }
export interface ReceiptItem { name: string; quantity: number; lineTotalCents: number; options: string[]; notes: string | null }
export interface OutboxReceipt {
  orderId: string; email: string; displayName: string; orderNumber: string; restaurantName: string; pickupName: string;
  placedAt: string; subtotalCents: number; serviceFeeCents: number; deliveryFeeCents: number; totalCents: number; gstCents: number;
  currency: string; items: ReceiptItem[];
}
export interface EmailOutbox {
  claimNotifications(limit: number): Promise<OutboxNotification[]>;
  notificationsSent(ids: string[]): Promise<void>;
  claimReceipts(limit: number): Promise<OutboxReceipt[]>;
  receiptsSent(orderIds: string[]): Promise<void>;
}
export interface EmailLinks { appUrl: string; dashboardUrl: string }

export function resendSender(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch }): EmailSender {
  const f = opts.fetchImpl ?? fetch;
  return {
    async send(m) {
      const res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
        body: JSON.stringify({ from: opts.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
  };
}

export function supabaseOutbox(admin: SupabaseClient): EmailOutbox {
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  return {
    async claimNotifications(limit) {
      const rows = await rpc<any[]>('email_outbox_claim', { p_limit: limit });
      return (rows ?? []).map((r) => ({ id: r.id, userId: r.user_id, email: r.email, displayName: r.display_name, type: r.type, title: r.title, body: r.body, data: r.data ?? {}, restaurantId: r.restaurant_id ?? null }));
    },
    async notificationsSent(ids) { if (ids.length) await rpc('email_outbox_done', { p_ids: ids }); },
    async claimReceipts(limit) {
      const rows = await rpc<any[]>('receipt_outbox_claim', { p_limit: limit });
      return (rows ?? []).map((r) => ({
        orderId: r.order_id, email: r.email, displayName: r.display_name, orderNumber: r.order_number, restaurantName: r.restaurant_name,
        pickupName: r.pickup_name, placedAt: r.placed_at, subtotalCents: r.subtotal_cents, serviceFeeCents: r.service_fee_cents,
        deliveryFeeCents: r.delivery_fee_cents, totalCents: r.total_cents, gstCents: r.gst_cents, currency: r.currency, items: r.items ?? [],
      }));
    },
    async receiptsSent(ids) { if (ids.length) await rpc('receipt_outbox_done', { p_order_ids: ids }); },
  };
}

// ---------- templates ----------

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const money = (cents: number, currency = 'AUD') =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.trim() || 'AUD' }).format(cents / 100);

function layout(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:28px 0 8px"><a href="${esc(cta.url)}" style="background:#ff3b5c;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;padding:28px" cellpadding="0" cellspacing="0"><tr><td>
<div style="font-weight:800;letter-spacing:2px;font-size:18px;color:#ff3b5c">CRAVE</div>
<h1 style="font-size:22px;margin:18px 0 10px">${esc(heading)}</h1>
${bodyHtml}${button}
</td></tr></table>
<p style="font-size:12px;color:#888;margin-top:16px">CRAVE · Brisbane, Australia. You're receiving this because of activity on your CRAVE account.</p>
</td></tr></table></body></html>`;
}

const para = (s: string) => `<p style="font-size:15px;line-height:1.5;margin:0 0 10px">${esc(s)}</p>`;
const orderId = (n: OutboxNotification) => (typeof n.data.order_id === 'string' ? n.data.order_id : null);

/** Builds the email for a notification, or null if this notification isn't emailed. */
export function notificationEmail(n: OutboxNotification, links: EmailLinks): EmailMessage | null {
  const key = `notification-${n.id}`;
  const id = orderId(n);
  if (n.type === 'new_order') {
    const url = n.restaurantId ? `${links.dashboardUrl}/restaurant/${n.restaurantId}/orders` : `${links.dashboardUrl}/restaurant`;
    const lines = [`Hi ${n.displayName}, you have a new order on CRAVE.`, n.body ?? '', 'Open your orders screen to accept it.'].filter(Boolean);
    return { to: n.email, subject: `🔔 ${n.title}`, idempotencyKey: key,
      html: layout(n.title, lines.map(para).join(''), { label: 'View orders', url }), text: `${lines.join('\n')}\n\n${url}` };
  }
  if (n.type === 'order_status' || n.type === 'refund') {
    const status = typeof n.data.status === 'string' ? n.data.status : null;
    const heading = n.type === 'refund' ? n.title
      : status === 'ready' ? 'Your order is ready to collect'
      : status === 'rejected' ? "The restaurant couldn't take your order"
      : status === 'cancelled' ? 'Your order was cancelled' : n.title;
    const extra = n.type === 'order_status' && (status === 'rejected' || status === 'cancelled')
      ? "If you've been charged, a full refund is on its way automatically." : '';
    const amount = typeof n.data.amount_cents === 'number' ? `Amount: ${money(n.data.amount_cents)}` : '';
    const lines = [`Hi ${n.displayName},`, n.title !== heading ? n.title : '', n.body ?? '', amount, extra].filter(Boolean);
    const url = id ? `${links.appUrl}/order/${id}` : links.appUrl;
    return { to: n.email, subject: heading, idempotencyKey: key,
      html: layout(heading, lines.map(para).join(''), { label: 'View order', url }), text: `${lines.join('\n')}\n\n${url}` };
  }
  return null;
}

export function receiptEmail(r: OutboxReceipt, links: EmailLinks): EmailMessage {
  const m = (c: number) => money(c, r.currency);
  const placed = new Date(r.placedAt).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' });
  const row = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0;font-size:14px${bold ? ';font-weight:700' : ''}">${label}</td><td align="right" style="padding:4px 0;font-size:14px${bold ? ';font-weight:700' : ''}">${esc(value)}</td></tr>`;
  const items = r.items.map((i) => {
    const sub = [...(i.options ?? []), i.notes ? `“${i.notes}”` : ''].filter(Boolean).join(' · ');
    return `<tr><td style="padding:6px 0;font-size:14px">${i.quantity} × ${esc(i.name)}${sub ? `<div style="color:#777;font-size:12px">${esc(sub)}</div>` : ''}</td><td align="right" valign="top" style="padding:6px 0;font-size:14px">${esc(m(i.lineTotalCents))}</td></tr>`;
  }).join('');
  const totals = [
    row('Subtotal', m(r.subtotalCents)),
    r.serviceFeeCents ? row('Service fee', m(r.serviceFeeCents)) : '',
    r.deliveryFeeCents ? row('Delivery', m(r.deliveryFeeCents)) : '',
    row('Total paid', m(r.totalCents), true),
    r.gstCents ? row('Includes GST of', m(r.gstCents)) : '',
  ].join('');
  const url = `${links.appUrl}/order/${r.orderId}`;
  const html = layout(`Thanks, ${r.displayName}!`,
    para(`Your order from ${r.restaurantName} is in. We'll let you know when it's ready.`)
    + `<p style="font-size:13px;color:#666;margin:0 0 14px">Order ${esc(r.orderNumber)} · ${esc(placed)} · Pickup name: ${esc(r.pickupName)}</p>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;border-bottom:1px solid #eee;margin-bottom:10px">${items}</table>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${totals}</table>`
    + `<p style="font-size:12px;color:#888;margin-top:14px">Order receipt. For a tax invoice, contact ${esc(r.restaurantName)}.</p>`,
    { label: 'Track your order', url });
  const text = [
    `Thanks, ${r.displayName}! Your order from ${r.restaurantName} is in.`, `Order ${r.orderNumber} · ${placed} · Pickup name: ${r.pickupName}`, '',
    ...r.items.map((i) => `${i.quantity} x ${i.name}  ${m(i.lineTotalCents)}${i.options?.length ? ` (${i.options.join(', ')})` : ''}`), '',
    `Subtotal ${m(r.subtotalCents)}`, r.serviceFeeCents ? `Service fee ${m(r.serviceFeeCents)}` : '', r.deliveryFeeCents ? `Delivery ${m(r.deliveryFeeCents)}` : '',
    `Total paid ${m(r.totalCents)}`, r.gstCents ? `Includes GST of ${m(r.gstCents)}` : '', '', `Track your order: ${url}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  return { to: r.email, subject: `Your CRAVE order receipt — ${r.orderNumber}`, html, text, idempotencyKey: `receipt-${r.orderId}` };
}

/** One outbox pass. Failed sends stay unsent and are retried after their lease expires. */
export async function runEmailJobs(outbox: EmailOutbox, sender: EmailSender, links: EmailLinks, log: (m: string, e?: unknown) => void = () => {}) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  const done: string[] = [];
  for (const n of await outbox.claimNotifications(25)) {
    const msg = notificationEmail(n, links);
    if (!msg) { done.push(n.id); result.skipped += 1; continue; }
    try { await sender.send(msg); done.push(n.id); result.sent += 1; } catch (e) { log(`email ${n.id} failed`, e); result.failed += 1; }
  }
  await outbox.notificationsSent(done);
  const receipts: string[] = [];
  for (const r of await outbox.claimReceipts(25)) {
    try { await sender.send(receiptEmail(r, links)); receipts.push(r.orderId); result.sent += 1; } catch (e) { log(`receipt ${r.orderId} failed`, e); result.failed += 1; }
  }
  await outbox.receiptsSent(receipts);
  return result;
}
