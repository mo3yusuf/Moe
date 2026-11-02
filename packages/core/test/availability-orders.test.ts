import { describe, expect, it } from 'vitest';
import { allowedNextStatuses, canTransition, isOpenAt, isTerminal, localClock, orderability, type OpeningPeriod } from '../src';

const TZ = 'Australia/Brisbane';
// Brisbane is UTC+10 with no DST.
const at = (iso: string) => new Date(iso);

describe('opening hours', () => {
  const periods: OpeningPeriod[] = [
    { dayOfWeek: 1, opensAt: '11:00', closesAt: '21:00' }, // Monday
    { dayOfWeek: 5, opensAt: '17:00', closesAt: '02:00' }, // Friday late night
  ];

  it('computes Brisbane local time', () => {
    // 2026-11-02 is a Monday. 01:00Z = 11:00 Brisbane.
    expect(localClock(at('2026-11-02T01:00:00Z'), TZ)).toEqual({ date: '2026-11-02', dayOfWeek: 1, minutes: 660 });
  });

  it('is open within a same-day period and closed at the boundary', () => {
    expect(isOpenAt(periods, at('2026-11-02T01:00:00Z'), TZ)).toBe(true); // Mon 11:00
    expect(isOpenAt(periods, at('2026-11-02T00:59:00Z'), TZ)).toBe(false); // Mon 10:59
    expect(isOpenAt(periods, at('2026-11-02T11:00:00Z'), TZ)).toBe(false); // Mon 21:00 (close is exclusive)
  });

  it('handles periods that run past midnight', () => {
    // Fri 2026-11-06 23:00 Brisbane = 13:00Z; Sat 01:30 Brisbane = Fri 15:30Z
    expect(isOpenAt(periods, at('2026-11-06T13:00:00Z'), TZ)).toBe(true);
    expect(isOpenAt(periods, at('2026-11-06T15:30:00Z'), TZ)).toBe(true);
    expect(isOpenAt(periods, at('2026-11-06T16:30:00Z'), TZ)).toBe(false); // Sat 02:30
  });

  it('respects special closures', () => {
    expect(isOpenAt(periods, at('2026-11-02T01:00:00Z'), TZ, [{ date: '2026-11-02' }])).toBe(false);
  });
});

describe('orderability', () => {
  const ok = {
    restaurantStatus: 'active' as const,
    acceptingOrders: true,
    pickupEnabled: true,
    isOpenNow: true,
    acceptsAdvanceOrders: false,
    itemAvailable: true,
    linkApproved: true,
  };
  it('allows ordering only when every rule passes', () => {
    expect(orderability(ok)).toEqual({ orderable: true });
    expect(orderability({ ...ok, isOpenNow: false })).toEqual({ orderable: false, reason: 'closed' });
    expect(orderability({ ...ok, isOpenNow: false, acceptsAdvanceOrders: true })).toEqual({ orderable: true });
    expect(orderability({ ...ok, itemAvailable: false })).toEqual({ orderable: false, reason: 'item_unavailable' });
    expect(orderability({ ...ok, restaurantStatus: 'pending_verification' })).toMatchObject({ reason: 'restaurant_not_active' });
    expect(orderability({ ...ok, linkApproved: false })).toMatchObject({ reason: 'link_not_verified' });
    expect(orderability({ ...ok, acceptingOrders: false })).toMatchObject({ reason: 'not_accepting_orders' });
  });
});

describe('order lifecycle', () => {
  it('only lets the payment webhook (system) move an order to placed', () => {
    expect(canTransition('pending_payment', 'placed', 'system')).toBe(true);
    expect(canTransition('pending_payment', 'placed', 'customer')).toBe(false);
    expect(canTransition('pending_payment', 'placed', 'restaurant')).toBe(false);
  });

  it('lets restaurants progress orders but not customers', () => {
    expect(allowedNextStatuses('placed', 'restaurant').sort()).toEqual(['accepted', 'rejected']);
    expect(canTransition('accepted', 'preparing', 'customer')).toBe(false);
    expect(canTransition('preparing', 'ready_for_pickup', 'restaurant')).toBe(true);
  });

  it('customers can cancel only before the restaurant accepts', () => {
    expect(canTransition('placed', 'cancelled', 'customer')).toBe(true);
    expect(canTransition('accepted', 'cancelled', 'customer')).toBe(false);
  });

  it('terminal states have no exits', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('placed')).toBe(false);
    expect(canTransition('completed', 'cancelled', 'admin')).toBe(false);
  });
});
