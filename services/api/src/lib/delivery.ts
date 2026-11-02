import { createHmac, timingSafeEqual } from 'node:crypto';
import { haversineKm, type DeliveryAddress } from '@crave/core';

/**
 * Delivery partner boundary (e.g. DoorDash Drive, Uber Direct). CRAVE never shows courier
 * locations or progress it did not receive from the partner.
 *
 * No production partner is integrated yet: it needs a commercial agreement and API credentials.
 * `sandboxDeliveryProvider` exists ONLY for automated tests and local development; the API refuses
 * to start with it in production.
 */
export interface DeliveryQuote { quoteId: string; feeCents: number; etaMinutes: number; expiresAt: Date }
export interface DeliveryStatusUpdate {
  externalId: string;
  status: 'requested' | 'courier_assigned' | 'picked_up' | 'delivered' | 'cancelled' | 'failed';
  trackingUrl: string | null;
  courierName: string | null;
  eta: Date | null;
  eventAt: Date;
}

export interface DeliveryProvider {
  readonly name: string;
  quote(input: { pickup: { lat: number; lng: number; address: string }; dropoff: DeliveryAddress; orderValueCents: number }): Promise<DeliveryQuote>;
  create(input: { quoteId: string; orderNumber: string; pickup: { address: string; lat: number; lng: number; phone: string | null; name: string; readyInMinutes: number };
    dropoff: DeliveryAddress & { name: string }; orderValueCents: number }): Promise<{ externalId: string; trackingUrl: string | null }>;
  cancel(externalId: string): Promise<void>;
  /** Verifies a partner webhook (signature over the raw body) and normalises it. Throws if invalid. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): DeliveryStatusUpdate;
}

/** Deterministic in-memory provider for tests and local development only. */
export function sandboxDeliveryProvider(secret: string): DeliveryProvider {
  let n = 0;
  return {
    name: 'sandbox',
    async quote({ pickup, dropoff }) {
      const km = haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
      n += 1;
      return { quoteId: `sbq_${n}`, feeCents: 499 + Math.round(km * 100), etaMinutes: 20 + Math.round(km * 3), expiresAt: new Date(Date.now() + 5 * 60_000) };
    },
    async create({ quoteId }) {
      return { externalId: `sbd_${quoteId.slice(4)}`, trackingUrl: null };
    },
    async cancel() {},
    parseWebhook(raw, headers) {
      const sig = headers['x-sandbox-signature'] ?? '';
      const expected = createHmac('sha256', secret).update(raw).digest('hex');
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('invalid signature');
      const b = JSON.parse(raw);
      return { externalId: b.id, status: b.status, trackingUrl: b.tracking_url ?? null, courierName: b.courier_name ?? null, eta: b.eta ? new Date(b.eta) : null, eventAt: new Date(b.event_at) };
    },
  };
}
