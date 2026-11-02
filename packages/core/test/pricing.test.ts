import { describe, expect, it } from 'vitest';
import { parseServiceFeeConfig, PricingError, quoteBasket, serviceFee, validateSelection, type ItemDef } from '../src/pricing';

const burger: ItemDef = {
  id: 'burger', name: 'Classic Double Smash', priceCents: 1690, isAvailable: true, gstApplicable: true,
  optionGroups: [
    { id: 'size', name: 'Patties', minSelect: 1, maxSelect: 1, options: [
      { id: 'double', name: 'Double', priceDeltaCents: 0, isAvailable: true },
      { id: 'triple', name: 'Triple', priceDeltaCents: 450, isAvailable: true }] },
    { id: 'extras', name: 'Extras', minSelect: 0, maxSelect: 2, options: [
      { id: 'bacon', name: 'Beef bacon', priceDeltaCents: 350, isAvailable: true },
      { id: 'jal', name: 'Jalapeños', priceDeltaCents: 150, isAvailable: true },
      { id: 'cheese', name: 'Extra cheese', priceDeltaCents: 200, isAvailable: false }] },
  ],
};
const fries: ItemDef = { id: 'fries', name: 'Loaded Fries', priceCents: 990, isAvailable: true, gstApplicable: true, optionGroups: [] };
const gstFree: ItemDef = { id: 'water', name: 'Bottled water (GST-free demo)', priceCents: 400, isAvailable: true, gstApplicable: false, optionGroups: [] };

describe('validateSelection', () => {
  it('accepts a valid selection', () => expect(validateSelection(burger, ['triple', 'bacon'])).toEqual([]));
  it('enforces required choices and maximums', () => {
    expect(validateSelection(burger, []).map((e) => e.code)).toEqual(['too_few']);
    expect(validateSelection(burger, ['double', 'triple']).map((e) => e.code)).toContain('too_many');
    expect(validateSelection(burger, ['double', 'bacon', 'jal', 'cheese']).map((e) => e.code)).toEqual(expect.arrayContaining(['too_many', 'option_unavailable']));
  });
  it('rejects unknown, duplicate and unavailable options, and sold-out items', () => {
    expect(validateSelection(burger, ['double', 'gold-leaf']).map((e) => e.code)).toContain('unknown_option');
    expect(validateSelection(burger, ['double', 'bacon', 'bacon']).map((e) => e.code)).toContain('duplicate_option');
    expect(validateSelection({ ...fries, isAvailable: false }, []).map((e) => e.code)).toEqual(['item_unavailable']);
  });
});

describe('quoteBasket', () => {
  it('prices options, quantities, fees, GST and commission in cents', () => {
    const q = quoteBasket([
      { item: burger, optionIds: ['triple', 'bacon'], quantity: 2 },
      { item: fries, optionIds: [], quantity: 1 },
    ], { commissionRateBps: 1000 });
    expect(q.lines[0]).toMatchObject({ unitPriceCents: 1690 + 450 + 350, lineTotalCents: 2490 * 2 });
    expect(q.subtotalCents).toBe(4980 + 990);
    expect(q.serviceFeeCents).toBe(99);
    expect(q.totalCents).toBe(5970 + 99);
    expect(q.gstCents).toBe(Math.round(5970 / 11) + Math.round(99 / 11)); // 543 + 9
    expect(q.commissionCents).toBe(597);
    expect(q.restaurantNetCents).toBe(5970 - 597);
    expect(q.itemCount).toBe(3);
  });
  it('excludes GST-free items from GST', () => {
    const q = quoteBasket([{ item: gstFree, optionIds: [], quantity: 1 }], { commissionRateBps: 1000 });
    expect(q.gstCents).toBe(9); // only the service fee carries GST
  });
  it('supports per-restaurant commission rates', () => {
    expect(quoteBasket([{ item: fries, optionIds: [], quantity: 1 }], { commissionRateBps: 800 }).commissionCents).toBe(79);
  });
  it('refuses invalid baskets with all reasons', () => {
    expect(() => quoteBasket([], { commissionRateBps: 1000 })).toThrow(PricingError);
    try {
      quoteBasket([{ item: burger, optionIds: [], quantity: 0 }], { commissionRateBps: 1000 });
      expect.unreachable();
    } catch (e) {
      expect((e as PricingError).errors.length).toBe(2);
    }
    expect(() => quoteBasket([{ item: fries, optionIds: [], quantity: 1.5 }], { commissionRateBps: 1000 })).toThrow(PricingError);
    expect(() => quoteBasket([{ item: { ...fries, priceCents: 99_000 }, optionIds: [], quantity: 3 }], { commissionRateBps: 1000 })).toThrow(/2,000/);
  });
  it('totals always reconcile: total = subtotal + fee, net + commission = subtotal', () => {
    for (let i = 1; i < 40; i++) {
      const q = quoteBasket([{ item: { ...fries, priceCents: 37 * i + 3 }, optionIds: [], quantity: (i % 5) + 1 }], { commissionRateBps: 1234 });
      expect(q.totalCents).toBe(q.subtotalCents + q.serviceFeeCents);
      expect(q.restaurantNetCents + q.commissionCents).toBe(q.subtotalCents);
      expect(Number.isInteger(q.gstCents)).toBe(true);
    }
  });
});

describe('service fee', () => {
  it('applies fixed + percent within min/max', () => {
    expect(serviceFee(1000)).toBe(99);
    expect(serviceFee(10_000, { percentBps: 300, fixedCents: 50, minCents: 99, maxCents: 299 })).toBe(299);
    expect(serviceFee(0)).toBe(0);
  });
  it('ignores invalid admin settings', () => {
    expect(parseServiceFeeConfig({ percent_bps: -5, fixed_cents: 'free', min_cents: 500, max_cents: 100 })).toEqual({ percentBps: 0, fixedCents: 99, minCents: 99, maxCents: 299 });
    expect(parseServiceFeeConfig({ percent_bps: 0, fixed_cents: 99, min_cents: 99, max_cents: 299 })).toEqual({ percentBps: 0, fixedCents: 99, minCents: 99, maxCents: 299 });
  });
});
