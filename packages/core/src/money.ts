/** All money is integer minor units (cents). Never use floats for stored amounts. */
export type Cents = number;

export function assertCents(value: number, label = 'amount'): asserts value is Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be an integer number of cents, got ${value}`);
}

export function formatMoney(cents: Cents, currency = 'AUD', locale = 'en-AU'): string {
  assertCents(cents);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/**
 * Tax component contained in a tax-inclusive amount. For Australian GST at 10% this is 1/11th.
 * Uses round-half-up on the cent, the conventional approach for GST on a total.
 */
export function taxIncludedIn(inclusiveCents: Cents, rateBps = 1000): Cents {
  assertCents(inclusiveCents);
  if (inclusiveCents <= 0 || rateBps <= 0) return 0;
  return Math.round((inclusiveCents * rateBps) / (10000 + rateBps));
}

/** Percentage of an amount in basis points, rounded to the nearest cent. */
export function applyBps(cents: Cents, bps: number): Cents {
  assertCents(cents);
  return Math.round((cents * bps) / 10000);
}
