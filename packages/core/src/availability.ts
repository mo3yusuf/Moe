/**
 * Restaurant opening-hours and orderability rules.
 *
 * Times are stored as local wall-clock times in the restaurant's IANA timezone
 * (Brisbane = 'Australia/Brisbane', which has no daylight saving). Using Intl
 * keeps this correct for future cities that do observe DST (Sydney, Melbourne).
 */

/** 0 = Sunday … 6 = Saturday (matches Postgres EXTRACT(DOW) and JS Date#getDay). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface OpeningPeriod {
  dayOfWeek: DayOfWeek;
  /** 'HH:MM' 24h local time. */
  opensAt: string;
  /** 'HH:MM' 24h local time. If <= opensAt the period runs past midnight. */
  closesAt: string;
}

export interface SpecialClosure {
  /** 'YYYY-MM-DD' local date the restaurant is closed all day. */
  date: string;
}

export interface LocalClock {
  date: string; // YYYY-MM-DD
  dayOfWeek: DayOfWeek;
  minutes: number; // minutes since local midnight
}

const WEEKDAYS: Record<string, DayOfWeek> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function parseHHMM(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid time '${value}', expected HH:MM`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const dayOfWeek = WEEKDAYS[get('weekday')];
  if (dayOfWeek === undefined) throw new Error('Unable to resolve weekday');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    dayOfWeek,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function previousDay(day: DayOfWeek): DayOfWeek {
  return ((day + 6) % 7) as DayOfWeek;
}

/** True when the restaurant is open at `now` according to its weekly periods. */
export function isOpenAt(
  periods: readonly OpeningPeriod[],
  now: Date,
  timeZone: string,
  closures: readonly SpecialClosure[] = [],
): boolean {
  const clock = localClock(now, timeZone);
  if (closures.some((c) => c.date === clock.date)) return false;

  return periods.some((p) => {
    const open = parseHHMM(p.opensAt);
    const close = parseHHMM(p.closesAt);
    const overnight = close <= open;
    if (p.dayOfWeek === clock.dayOfWeek) {
      return overnight ? clock.minutes >= open : clock.minutes >= open && clock.minutes < close;
    }
    // Overnight period that started yesterday and is still running after midnight.
    return overnight && p.dayOfWeek === previousDay(clock.dayOfWeek) && clock.minutes < close;
  });
}

export type RestaurantStatus = 'draft' | 'pending_verification' | 'active' | 'suspended';

export interface OrderabilityInput {
  restaurantStatus: RestaurantStatus;
  acceptingOrders: boolean;
  pickupEnabled: boolean;
  isOpenNow: boolean;
  acceptsAdvanceOrders: boolean;
  itemAvailable: boolean;
  /** Video → menu item link must be approved before the item is orderable from a video. */
  linkApproved?: boolean;
}

export type NotOrderableReason =
  | 'restaurant_not_active'
  | 'not_accepting_orders'
  | 'pickup_unavailable'
  | 'closed'
  | 'item_unavailable'
  | 'link_not_verified';

export function orderability(input: OrderabilityInput): { orderable: true } | { orderable: false; reason: NotOrderableReason } {
  if (input.restaurantStatus !== 'active') return { orderable: false, reason: 'restaurant_not_active' };
  if (input.linkApproved === false) return { orderable: false, reason: 'link_not_verified' };
  if (!input.acceptingOrders) return { orderable: false, reason: 'not_accepting_orders' };
  if (!input.pickupEnabled) return { orderable: false, reason: 'pickup_unavailable' };
  if (!input.itemAvailable) return { orderable: false, reason: 'item_unavailable' };
  if (!input.isOpenNow && !input.acceptsAdvanceOrders) return { orderable: false, reason: 'closed' };
  return { orderable: true };
}

export const NOT_ORDERABLE_MESSAGES: Record<NotOrderableReason, string> = {
  restaurant_not_active: 'This restaurant is not taking orders on CRAVE yet.',
  not_accepting_orders: 'This restaurant has paused orders right now.',
  pickup_unavailable: 'Pickup is not available at this restaurant right now.',
  closed: 'This restaurant is closed right now.',
  item_unavailable: 'This item is currently unavailable.',
  link_not_verified: 'This dish has not been verified by the restaurant yet.',
};
