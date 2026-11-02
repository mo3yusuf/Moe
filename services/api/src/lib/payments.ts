import Stripe from 'stripe';

/**
 * Payment provider boundary. Production uses Stripe Connect (destination charges): the customer pays
 * CRAVE, CRAVE keeps an application fee (commission + service fee) and Stripe transfers the rest to the
 * restaurant's connected account. Tests use an in-memory fake.
 */
export interface CreateIntentInput {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  applicationFeeCents: number;
  currency: string;
  destinationAccount: string;
  /** Make the restaurant the settlement merchant (statement descriptor, merchant of record). */
  onBehalfOf: boolean;
}

export interface PaymentProvider {
  readonly name: 'stripe';
  readonly testMode: boolean;
  createIntent(input: CreateIntentInput): Promise<{ id: string; clientSecret: string }>;
  cancelIntent(intentId: string): Promise<void>;
  refund(input: { intentId: string; amountCents: number; idempotencyKey: string; full: boolean }): Promise<{ id: string; status: 'pending' | 'succeeded' | 'failed' }>;
  createConnectedAccount(input: { restaurantId: string; restaurantName: string; email?: string; kind?: 'restaurant' | 'creator' }): Promise<string>;
  /** Pays approved creator commissions from CRAVE's balance to the creator's connected account. */
  transfer(input: { destination: string; amountCents: number; idempotencyKey: string; description: string }): Promise<{ id: string }>;
  onboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string>;
  dashboardLink(accountId: string): Promise<string>;
  /** Verifies the webhook signature against the raw request body; throws if invalid. */
  verifyWebhook(rawBody: string, signature: string): Promise<Stripe.Event>;
  listSucceededIntents(fromUnix: number, toUnix: number): Promise<{ id: string; amount: number; applicationFee: number | null; orderId: string | null }[]>;
}

export function stripeProvider(opts: { secretKey: string; webhookSecrets: string[] }): PaymentProvider {
  const stripe = new Stripe(opts.secretKey, { maxNetworkRetries: 2, appInfo: { name: 'CRAVE', version: '0.1.0' } });
  const testMode = opts.secretKey.startsWith('sk_test_') || opts.secretKey.startsWith('rk_test_');
  return {
    name: 'stripe',
    testMode,
    async createIntent(i) {
      const pi = await stripe.paymentIntents.create({
        amount: i.amountCents,
        currency: i.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        application_fee_amount: i.applicationFeeCents,
        transfer_data: { destination: i.destinationAccount },
        ...(i.onBehalfOf ? { on_behalf_of: i.destinationAccount } : {}),
        description: `CRAVE order ${i.orderNumber}`,
        metadata: { order_id: i.orderId, order_number: i.orderNumber },
      }, { idempotencyKey: `order-intent-${i.orderId}` });
      if (!pi.client_secret) throw new Error('Stripe did not return a client secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },
    async cancelIntent(id) {
      try { await stripe.paymentIntents.cancel(id); } catch (e) {
        // Already succeeded/canceled intents can't be cancelled; that's fine for expiry.
        if (!(e instanceof Stripe.errors.StripeInvalidRequestError)) throw e;
      }
    },
    async refund({ intentId, amountCents, idempotencyKey, full }) {
      const r = await stripe.refunds.create({
        payment_intent: intentId,
        amount: amountCents,
        // Pull the restaurant's share back for the refunded amount; on full refunds also return CRAVE's fee.
        reverse_transfer: true,
        refund_application_fee: full,
        metadata: { crave_refund_id: idempotencyKey },
      }, { idempotencyKey: `refund-${idempotencyKey}` });
      return { id: r.id, status: r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending' };
    },
    async createConnectedAccount({ restaurantId, restaurantName, email, kind = 'restaurant' }) {
      const acct = await stripe.accounts.create({
        country: 'AU',
        email,
        business_profile: kind === 'restaurant'
          ? { name: restaurantName, mcc: '5814', product_description: 'Restaurant meals sold for pickup via CRAVE' }
          : { name: restaurantName, mcc: '7311', product_description: 'Food content creator earning affiliate commissions on CRAVE' },
        controller: {
          stripe_dashboard: { type: 'express' },
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
        },
        // Creators only receive transfers; restaurants are also the settlement merchant for card payments.
        capabilities: kind === 'restaurant' ? { card_payments: { requested: true }, transfers: { requested: true } } : { transfers: { requested: true } },
        metadata: kind === 'restaurant' ? { restaurant_id: restaurantId } : { creator_id: restaurantId },
      }, { idempotencyKey: `connect-account-${kind}-${restaurantId}` });
      return acct.id;
    },
    async transfer({ destination, amountCents, idempotencyKey, description }) {
      const t = await stripe.transfers.create({ amount: amountCents, currency: 'aud', destination, description, transfer_group: idempotencyKey },
        { idempotencyKey: `creator-transfer-${idempotencyKey}` });
      return { id: t.id };
    },
    async onboardingLink(account, refresh_url, return_url) {
      return (await stripe.accountLinks.create({ account, refresh_url, return_url, type: 'account_onboarding' })).url;
    },
    async dashboardLink(account) {
      return (await stripe.accounts.createLoginLink(account)).url;
    },
    async verifyWebhook(rawBody, signature) {
      let lastError: unknown;
      // Platform and Connect endpoints have separate signing secrets.
      for (const secret of opts.webhookSecrets) {
        try { return await stripe.webhooks.constructEventAsync(rawBody, signature, secret); } catch (e) { lastError = e; }
      }
      throw lastError ?? new Error('No webhook secret configured');
    },
    async listSucceededIntents(from, to) {
      const out: { id: string; amount: number; applicationFee: number | null; orderId: string | null }[] = [];
      for await (const pi of stripe.paymentIntents.list({ created: { gte: from, lt: to }, limit: 100 })) {
        if (pi.status === 'succeeded') out.push({ id: pi.id, amount: pi.amount_received, applicationFee: pi.application_fee_amount, orderId: pi.metadata?.order_id ?? null });
      }
      return out;
    },
  };
}

export { Stripe };
