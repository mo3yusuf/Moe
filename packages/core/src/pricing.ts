import { applyBasisPoints, assertCents, gstFromInclusive, sumCents, type Cents } from './money';

/**
 * Pricing is computed SERVER-SIDE from database prices. The mobile app may call
 * the same function to show an estimate, but the API recomputes everything from
 * scratch before creating a payment, and never trusts client-sent amounts.
 */

export type FulfilmentType = 'pickup' | 'delivery';

export interface PricedOption {
  optionId: string;
  name: string;
  priceDeltaCents: Cents;
}

export interface PricedLine {
  menuItemId: string;
  name: string;
  unitPriceCents: Cents;
  quantity: number;
  options: PricedOption[];
}

export interface FeeConfig {
  /** Fixed customer service fee in cents (GST-inclusive). 0 disables. */
  serviceFeeCents: Cents;
  /** Optional percentage service fee in basis points, applied to subtotal. */
  serviceFeeBps: number;
  /** Cap for the service fee, in cents. null = no cap. */
  serviceFeeCapCents: Cents | null;
  /** Small order fee applied when subtotal is below threshold. */
  smallOrderThresholdCents: Cents;
  smallOrderFeeCents: Cents;
}

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  serviceFeeCents: 0,
  serviceFeeBps: 0,
  serviceFeeCapCents: null,
  smallOrderThresholdCents: 0,
  smallOrderFeeCents: 0,
};

export interface BasketQuoteInput {
  lines: PricedLine[];
  fulfilment: FulfilmentType;
  fees?: FeeConfig;
  /** Only used when fulfilment === 'delivery' and a provider returned a quote. */
  deliveryFeeCents?: Cents;
  /** Restaurant commission in basis points (1000 = 10%). */
  commissionBps: number;
}

export interface LineTotal {
  menuItemId: string;
  quantity: number;
  unitTotalCents: Cents;
  lineTotalCents: Cents;
}

export interface BasketQuote {
  lines: LineTotal[];
  subtotalCents: Cents;
  serviceFeeCents: Cents;
  smallOrderFeeCents: Cents;
  deliveryFeeCents: Cents;
  totalCents: Cents;
  /** GST included in the total (informational; restaurants are responsible for their own GST obligations). */
  gstIncludedCents: Cents;
  /** Platform commission charged to the restaurant on the food subtotal. */
  commissionCents: Cents;
  /** What the restaurant receives for the food, before payment processing fees. */
  restaurantNetCents: Cents;
}

export const MAX_LINE_QUANTITY = 50;

export function lineUnitTotal(line: PricedLine): Cents {
  return assertCents(line.unitPriceCents, 'unitPriceCents') + sumCents(line.options.map((o) => o.priceDeltaCents));
}

export function quoteBasket(input: BasketQuoteInput): BasketQuote {
  const fees = input.fees ?? DEFAULT_FEE_CONFIG;
  if (input.lines.length === 0) throw new Error('Basket is empty');

  const lines: LineTotal[] = input.lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
      throw new Error(`Invalid quantity ${line.quantity} for ${line.name}`);
    }
    const unit = lineUnitTotal(line);
    if (unit < 0) throw new Error(`Negative price for ${line.name}`);
    return {
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      unitTotalCents: unit,
      lineTotalCents: unit * line.quantity,
    };
  });

  const subtotal = sumCents(lines.map((l) => l.lineTotalCents));

  let serviceFee = fees.serviceFeeCents + applyBasisPoints(subtotal, fees.serviceFeeBps);
  if (fees.serviceFeeCapCents !== null) serviceFee = Math.min(serviceFee, fees.serviceFeeCapCents);

  const smallOrderFee =
    fees.smallOrderThresholdCents > 0 && subtotal < fees.smallOrderThresholdCents ? fees.smallOrderFeeCents : 0;

  let deliveryFee = 0;
  if (input.fulfilment === 'delivery') {
    if (input.deliveryFeeCents === undefined) {
      throw new Error('Delivery requires a delivery quote from an integrated provider');
    }
    deliveryFee = assertCents(input.deliveryFeeCents, 'deliveryFeeCents');
  }

  const total = subtotal + serviceFee + smallOrderFee + deliveryFee;
  const commission = applyBasisPoints(subtotal, input.commissionBps);

  return {
    lines,
    subtotalCents: subtotal,
    serviceFeeCents: serviceFee,
    smallOrderFeeCents: smallOrderFee,
    deliveryFeeCents: deliveryFee,
    totalCents: total,
    gstIncludedCents: gstFromInclusive(total),
    commissionCents: commission,
    restaurantNetCents: subtotal - commission,
  };
}
