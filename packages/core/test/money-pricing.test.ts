import { describe, expect, it } from 'vitest';
import { applyBasisPoints, formatMoney, gstFromInclusive, quoteBasket } from '../src';

describe('money', () => {
  it('extracts GST as 1/11th of a GST-inclusive total', () => {
    expect(gstFromInclusive(1100)).toBe(100);
    expect(gstFromInclusive(2450)).toBe(223); // 222.73 → 223
  });

  it('applies basis points with rounding', () => {
    expect(applyBasisPoints(2450, 1000)).toBe(245);
    expect(applyBasisPoints(1999, 1000)).toBe(200);
    expect(() => applyBasisPoints(100, 10_001)).toThrow();
    expect(() => applyBasisPoints(10.5, 100)).toThrow();
  });

  it('formats AUD for en-AU', () => {
    expect(formatMoney(2450)).toBe('$24.50');
  });
});

describe('quoteBasket', () => {
  const burger = {
    menuItemId: 'burger',
    name: 'Smash Burger',
    unitPriceCents: 1800,
    quantity: 2,
    options: [
      { optionId: 'cheese', name: 'Extra cheese', priceDeltaCents: 200 },
      { optionId: 'large', name: 'Large', priceDeltaCents: 350 },
    ],
  };

  it('computes subtotal, total, GST, commission and restaurant net for pickup', () => {
    const q = quoteBasket({ lines: [burger], fulfilment: 'pickup', commissionBps: 1000 });
    expect(q.lines[0]).toMatchObject({ unitTotalCents: 2350, lineTotalCents: 4700 });
    expect(q.subtotalCents).toBe(4700);
    expect(q.totalCents).toBe(4700);
    expect(q.gstIncludedCents).toBe(427);
    expect(q.commissionCents).toBe(470);
    expect(q.restaurantNetCents).toBe(4230);
  });

  it('applies service fee with cap and small order fee', () => {
    const q = quoteBasket({
      lines: [{ ...burger, quantity: 1, options: [] }],
      fulfilment: 'pickup',
      commissionBps: 1000,
      fees: { serviceFeeCents: 50, serviceFeeBps: 500, serviceFeeCapCents: 120, smallOrderThresholdCents: 2000, smallOrderFeeCents: 200 },
    });
    expect(q.serviceFeeCents).toBe(120); // 50 + 90 = 140 → capped at 120
    expect(q.smallOrderFeeCents).toBe(200);
    expect(q.totalCents).toBe(1800 + 120 + 200);
  });

  it('refuses delivery without a provider quote', () => {
    expect(() => quoteBasket({ lines: [burger], fulfilment: 'delivery', commissionBps: 1000 })).toThrow(/delivery quote/);
  });

  it('rejects empty baskets, bad quantities and fractional cents', () => {
    expect(() => quoteBasket({ lines: [], fulfilment: 'pickup', commissionBps: 1000 })).toThrow(/empty/);
    expect(() => quoteBasket({ lines: [{ ...burger, quantity: 0 }], fulfilment: 'pickup', commissionBps: 1000 })).toThrow();
    expect(() => quoteBasket({ lines: [{ ...burger, quantity: 51 }], fulfilment: 'pickup', commissionBps: 1000 })).toThrow();
    expect(() => quoteBasket({ lines: [{ ...burger, unitPriceCents: 18.5 }], fulfilment: 'pickup', commissionBps: 1000 })).toThrow();
  });

  it('supports per-restaurant commission agreements', () => {
    const q = quoteBasket({ lines: [burger], fulfilment: 'pickup', commissionBps: 750 });
    expect(q.commissionCents).toBe(353); // 4700 * 7.5% = 352.5 → 353
  });
});

import { coarsen, distanceKm } from '../src';
describe('geo', () => {
  it('computes Brisbane CBD → Fortitude Valley distance', () => {
    const d = distanceKm({ lat: -27.4698, lng: 153.0251 }, { lat: -27.4573, lng: 153.0352 });
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(1.8);
  });
  it('coarsens coordinates for privacy', () => {
    expect(coarsen(-27.469812)).toBe(-27.47);
  });
});
