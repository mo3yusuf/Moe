/**
 * Money is always handled as integer minor units (cents) to avoid floating
 * point errors. Never store or transmit dollars as floats.
 */
export type Cents = number;

export const SUPPORTED_CURRENCIES = ['AUD'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number] | (string & {});

/** Australian GST rate. Menu prices in Australia are displayed GST-inclusive. */
export const AU_GST_RATE = 0.1;

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of cents, received ${value}`);
  }
  return value;
}

/**
 * GST component of a GST-inclusive amount (1/11th for a 10% rate), rounded to the
 * nearest cent. Matches how Australian tax invoices show "includes GST of $x".
 */
export function gstFromInclusive(inclusive: Cents, rate = AU_GST_RATE): Cents {
  assertCents(inclusive, 'inclusive');
  return Math.round((inclusive * rate) / (1 + rate));
}

/** Percentage of an amount expressed in basis points (1% = 100 bps), half-up rounding. */
export function applyBasisPoints(amount: Cents, bps: number): Cents {
  assertCents(amount);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`basis points must be an integer between 0 and 10000, received ${bps}`);
  }
  return Math.round((amount * bps) / 10_000);
}

export function formatMoney(cents: Cents, currency: CurrencyCode = 'AUD', locale = 'en-AU'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((acc, v) => acc + assertCents(v), 0);
}
