/**
 * Server-authoritative pricing. The API recomputes every quote from database prices; clients only
 * display what the API returns. All amounts are integer cents, GST-inclusive (Australian practice).
 *
 * NOTE (needs accountant review before launch): GST treatment of the service fee and of commission,
 * whether CRAVE acts as agent or principal for the meal sale, and tax invoice requirements.
 */
import { applyBps, assertCents, taxIncludedIn } from './money';

export const PRICING_VERSION = 'pricing-v1';

export interface OptionDef {
  id: string;
  name: string;
  priceDeltaCents: number;
  isAvailable: boolean;
  /** How many times this option may be picked (e.g. "Extra patty" up to 3). Default 1. */
  maxQuantity?: number;
  imageUrl?: string | null;
  /** Combos: the menu item this choice stands for (sold out when that item is). */
  linkedMenuItemId?: string | null;
}

/** How a group is shown: a normal list, compact chips, or "remove ingredients" chips. */
export type OptionGroupStyle = 'list' | 'chips' | 'remove';

export interface OptionGroupDef {
  id: string;
  name: string;
  /** Counted in picks: an option chosen twice counts twice. */
  minSelect: number;
  maxSelect: number;
  /** Nested choice: the group only applies when this option is picked (e.g. Fries → sauce). */
  parentOptionId?: string | null;
  displayStyle?: OptionGroupStyle;
  options: OptionDef[];
}

export interface ItemDef {
  id: string;
  name: string;
  priceCents: number;
  isAvailable: boolean;
  gstApplicable: boolean;
  /** Meal deal: its choices link to other menu items. */
  isCombo?: boolean;
  optionGroups: OptionGroupDef[];
}

export type SelectionError =
  | { code: 'item_unavailable'; message: string }
  | { code: 'unknown_option'; message: string }
  | { code: 'option_unavailable'; message: string }
  | { code: 'too_few'; groupId: string; message: string }
  | { code: 'too_many'; groupId: string; message: string }
  | { code: 'duplicate_option'; message: string }
  | { code: 'inactive_option'; message: string };

/** Count of each option id in a selection (an id repeated = picked that many times). */
export function countSelection(optionIds: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of optionIds) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** Groups that apply for this selection: top-level groups, plus nested groups whose parent option is picked. */
export function activeGroups(item: ItemDef, optionIds: string[]): OptionGroupDef[] {
  const picked = new Set(optionIds);
  return item.optionGroups.filter((g) => !g.parentOptionId || picked.has(g.parentOptionId));
}

/** Validates customisations against the item's option groups. Returns [] when valid. */
export function validateSelection(item: ItemDef, optionIds: string[]): SelectionError[] {
  const errors: SelectionError[] = [];
  if (!item.isAvailable) errors.push({ code: 'item_unavailable', message: `${item.name} is sold out` });
  const owner = new Map<string, { group: OptionGroupDef; option: OptionDef }>();
  for (const g of item.optionGroups) for (const o of g.options) owner.set(o.id, { group: g, option: o });
  const counts = countSelection(optionIds);
  const active = new Set(activeGroups(item, optionIds).map((g) => g.id));
  for (const [id, n] of counts) {
    const hit = owner.get(id);
    if (!hit) { errors.push({ code: 'unknown_option', message: 'That option is no longer on the menu' }); continue; }
    if (!hit.option.isAvailable) errors.push({ code: 'option_unavailable', message: `${hit.option.name} is unavailable` });
    if (n > (hit.option.maxQuantity ?? 1)) {
      errors.push({ code: 'duplicate_option', message: (hit.option.maxQuantity ?? 1) > 1 ? `At most ${hit.option.maxQuantity} × ${hit.option.name}` : 'An option was selected twice' });
    }
    if (!active.has(hit.group.id)) errors.push({ code: 'inactive_option', message: `${hit.option.name} doesn’t go with your other choices` });
  }
  for (const g of item.optionGroups) {
    if (!active.has(g.id)) continue;
    const n = g.options.reduce((a, o) => a + (counts.get(o.id) ?? 0), 0);
    if (n < g.minSelect) errors.push({ code: 'too_few', groupId: g.id, message: `Choose ${g.minSelect === 1 && g.maxSelect === 1 ? 'one' : `at least ${g.minSelect}`} for ${g.name}` });
    if (n > g.maxSelect) errors.push({ code: 'too_many', groupId: g.id, message: `Choose at most ${g.maxSelect} for ${g.name}` });
  }
  return errors;
}

/** Chosen options with quantities, as shown to the kitchen and on receipts ("2× Bacon", "No onions"). */
export function describeSelection(item: ItemDef, optionIds: string[]): { id: string; name: string; priceDeltaCents: number; quantity: number }[] {
  const counts = countSelection(optionIds);
  const out: { id: string; name: string; priceDeltaCents: number; quantity: number }[] = [];
  for (const g of item.optionGroups) {
    for (const o of g.options) {
      const q = counts.get(o.id);
      if (!q) continue;
      const base = g.displayStyle === 'remove' && !/^no\b/i.test(o.name) ? `No ${o.name.toLowerCase()}` : o.name;
      out.push({ id: o.id, name: q > 1 ? `${q}× ${base}` : base, priceDeltaCents: o.priceDeltaCents, quantity: q });
    }
  }
  return out;
}

/** Unit price for an item with a selection (base + every picked option × its count). */
export function unitPriceCents(item: ItemDef, optionIds: string[]): number {
  return describeSelection(item, optionIds).reduce((a, o) => a + o.priceDeltaCents * o.quantity, item.priceCents);
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
  options: { id: string; name: string; priceDeltaCents: number; quantity?: number }[];
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
  opts: { commissionRateBps: number; serviceFee?: ServiceFeeConfig; taxRateBps?: number; currency?: string; deliveryFeeCents?: number },
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
    const chosen = describeSelection(l.item, l.optionIds);
    const unit = unitPriceCents(l.item, l.optionIds);
    assertCents(unit, 'unit price');
    return {
      menuItemId: l.item.id,
      name: l.item.name,
      options: chosen.map((o) => ({ id: o.id, name: o.name, priceDeltaCents: o.priceDeltaCents, quantity: o.quantity })),
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
  const delivery = opts.deliveryFeeCents ?? 0;
  assertCents(delivery, 'delivery fee');
  if (delivery < 0) throw new PricingError([{ code: 'bad_delivery_fee', message: 'Invalid delivery fee' }]);
  const gst = taxIncludedIn(taxableFood, taxRate) + taxIncludedIn(fee, taxRate) + taxIncludedIn(delivery, taxRate);
  const commission = applyBps(subtotal, opts.commissionRateBps);

  return {
    pricingVersion: PRICING_VERSION,
    currency: opts.currency ?? 'AUD',
    lines: quoteLines,
    subtotalCents: subtotal,
    serviceFeeCents: fee,
    deliveryFeeCents: delivery,
    discountCents: 0,
    totalCents: subtotal + fee + delivery,
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
