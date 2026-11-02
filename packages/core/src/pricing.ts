/**
 * Server-authoritative pricing. The API recomputes every quote from database prices; clients only
 * display what the API returns. All amounts are integer cents, GST-inclusive (Australian practice).
 *
 * NOTE (needs accountant review before launch): GST treatment of the service fee and of commission,
 * whether CRAVE acts as agent or principal for the meal sale, and tax invoice requirements.
 */
import { applyBps, assertCents, taxIncludedIn } from './money';

export const PRICING_VERSION = 'pricing-v1';

export interface OptionGroupDef {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { id: string; name: string; priceDeltaCents: number; isAvailable: boolean }[];
}

export interface ItemDef {
  id: string;
  name: string;
  priceCents: number;
  isAvailable: boolean;
  gstApplicable: boolean;
  optionGroups: OptionGroupDef[];
}

export type SelectionError =
  | { code: 'item_unavailable'; message: string }
  | { code: 'unknown_option'; message: string }
  | { code: 'option_unavailable'; message: string }
  | { code: 'too_few'; groupId: string; message: string }
  | { code: 'too_many'; groupId: string; message: string }
  | { code: 'duplicate_option'; message: string };

/** Validates customisations against the item's option groups. Returns [] when valid. */
export function validateSelection(item: ItemDef, optionIds: string[]): SelectionError[] {
  const errors: SelectionError[] = [];
  if (!item.isAvailable) errors.push({ code: 'item_unavailable', message: `${item.name} is sold out` });
  if (new Set(optionIds).size !== optionIds.length) errors.push({ code: 'duplicate_option', message: 'An option was selected twice' });
  const owner = new Map<string, { group: OptionGroupDef; option: OptionGroupDef['options'][number] }>();
  for (const g of item.optionGroups) for (const o of g.options) owner.set(o.id, { group: g, option: o });
  for (const id of optionIds) {
    const hit = owner.get(id);
    if (!hit) errors.push({ code: 'unknown_option', message: 'That option is no longer on the menu' });
    else if (!hit.option.isAvailable) errors.push({ code: 'option_unavailable', message: `${hit.option.name} is unavailable` });
  }
  for (const g of item.optionGroups) {
    const n = optionIds.filter((id) => owner.get(id)?.group.id === g.id).length;
    if (n < g.minSelect) errors.push({ code: 'too_few', groupId: g.id, message: `Choose ${g.minSelect === 1 && g.maxSelect === 1 ? 'one' : `at least ${g.minSelect}`} for ${g.name}` });
    if (n > g.maxSelect) errors.push({ code: 'too_many', groupId: g.id, message: `Choose at most ${g.maxSelect} for ${g.name}` });
  }
  return errors;
}

export interface BasketLineInput {
  item: ItemDef;
  optionIds: string[];
  quantity: number;
  notes?: string | null;
  sourceVideoId?: string | null;
}

export interface ServiceFeeConfig {
  percentBps: number;
  fixedCents: number;
  minCents: number;
  maxCents: number;
}

export const DEFAULT_SERVICE_FEE: ServiceFeeConfig = { percentBps: 0, fixedCents: 99, minCents: 99, maxCents: 299 };

export interface QuoteLine {
  menuItemId: string;
  name: string;
  options: { id: string; name: string; priceDeltaCents: number }[];
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  gstApplicable: boolean;
  notes: string | null;
  sourceVideoId: string | null;
}

export interface Quote {
  pricingVersion: string;
  currency: string;
  lines: QuoteLine[];
  subtotalCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  /** GST included in the total (taxable lines + service fee). */
  gstCents: number;
  commissionRateBps: number;
  /** Platform commission on the food subtotal. */
  commissionCents: number;
  /** Food subtotal minus commission, before payment-processing fees (handled in Phase 7). */
  restaurantNetCents: number;
  itemCount: number;
}

export class PricingError extends Error {
  constructor(public errors: SelectionError[] | { code: string; message: string }[]) {
    super(errors.map((e) => e.message).join('; '));
  }
}

export const MAX_QUANTITY_PER_LINE = 50;
export const MAX_LINES = 30;
export const MAX_ORDER_CENTS = 200_000; // $2,000 safety cap for a pickup order

export function serviceFee(subtotalCents: number, cfg: ServiceFeeConfig = DEFAULT_SERVICE_FEE): number {
  if (subtotalCents <= 0) return 0;
  const raw = cfg.fixedCents + applyBps(subtotalCents, cfg.percentBps);
  return Math.min(cfg.maxCents, Math.max(cfg.minCents, raw));
}

export function quoteBasket(
  lines: BasketLineInput[],
  opts: { commissionRateBps: number; serviceFee?: ServiceFeeConfig; taxRateBps?: number; currency?: string },
): Quote {
  if (!lines.length) throw new PricingError([{ code: 'empty', message: 'Your basket is empty' }]);
  if (lines.length > MAX_LINES) throw new PricingError([{ code: 'too_many_lines', message: `At most ${MAX_LINES} items per order` }]);
  const taxRate = opts.taxRateBps ?? 1000;

  const errors: SelectionError[] = [];
  const quoteLines: QuoteLine[] = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QUANTITY_PER_LINE) {
      errors.push({ code: 'too_many', groupId: '', message: `Quantity must be between 1 and ${MAX_QUANTITY_PER_LINE}` });
    }
    errors.push(...validateSelection(l.item, l.optionIds));
    const chosen = l.item.optionGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id));
    const unit = l.item.priceCents + chosen.reduce((a, o) => a + o.priceDeltaCents, 0);
    assertCents(unit, 'unit price');
    return {
      menuItemId: l.item.id,
      name: l.item.name,
      options: chosen.map((o) => ({ id: o.id, name: o.name, priceDeltaCents: o.priceDeltaCents })),
      unitPriceCents: Math.max(0, unit),
      quantity: l.quantity,
      lineTotalCents: Math.max(0, unit) * l.quantity,
      gstApplicable: l.item.gstApplicable,
      notes: l.notes?.trim().slice(0, 200) || null,
      sourceVideoId: l.sourceVideoId ?? null,
    };
  });
  if (errors.length) throw new PricingError(errors);

  const subtotal = quoteLines.reduce((a, l) => a + l.lineTotalCents, 0);
  if (subtotal > MAX_ORDER_CENTS) throw new PricingError([{ code: 'order_too_large', message: 'Orders over $2,000 need to be arranged with the restaurant directly' }]);
  const fee = serviceFee(subtotal, opts.serviceFee);
  const taxableFood = quoteLines.filter((l) => l.gstApplicable).reduce((a, l) => a + l.lineTotalCents, 0);
  const gst = taxIncludedIn(taxableFood, taxRate) + taxIncludedIn(fee, taxRate);
  const commission = applyBps(subtotal, opts.commissionRateBps);

  return {
    pricingVersion: PRICING_VERSION,
    currency: opts.currency ?? 'AUD',
    lines: quoteLines,
    subtotalCents: subtotal,
    serviceFeeCents: fee,
    deliveryFeeCents: 0,
    discountCents: 0,
    totalCents: subtotal + fee,
    gstCents: gst,
    commissionRateBps: opts.commissionRateBps,
    commissionCents: commission,
    restaurantNetCents: subtotal - commission,
    itemCount: quoteLines.reduce((a, l) => a + l.quantity, 0),
  };
}

/** Validates admin-provided fee settings; falls back to defaults on anything odd. */
export function parseServiceFeeConfig(raw: unknown): ServiceFeeConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (k: string, d: number, max: number) => {
    const v = r[k];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : d;
  };
  const cfg = {
    percentBps: num('percent_bps', DEFAULT_SERVICE_FEE.percentBps, 2000),
    fixedCents: num('fixed_cents', DEFAULT_SERVICE_FEE.fixedCents, 2000),
    minCents: num('min_cents', DEFAULT_SERVICE_FEE.minCents, 2000),
    maxCents: num('max_cents', DEFAULT_SERVICE_FEE.maxCents, 5000),
  };
  return cfg.minCents <= cfg.maxCents ? cfg : DEFAULT_SERVICE_FEE;
}
