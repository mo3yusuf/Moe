import { describe, expect, it } from 'vitest';
import { applyBps, formatMoney, taxIncludedIn } from '../src/money';

describe('money', () => {
  it('formats AUD for en-AU', () => {
    expect(formatMoney(1690)).toBe('$16.90');
    expect(formatMoney(0)).toBe('$0.00');
  });
  it('computes GST included in a GST-inclusive price (1/11th)', () => {
    expect(taxIncludedIn(1100)).toBe(100);
    expect(taxIncludedIn(1690)).toBe(154); // 153.6 -> 154
    expect(taxIncludedIn(0)).toBe(0);
  });
  it('applies basis points', () => {
    expect(applyBps(1690, 1000)).toBe(169);
    expect(applyBps(1695, 1000)).toBe(170); // 169.5 rounds half up
  });
  it('rejects non-integer cents', () => {
    expect(() => formatMoney(16.9)).toThrow(RangeError);
  });
});
