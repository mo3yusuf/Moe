/** Time-of-week context, evaluated in the city's local timezone (Brisbane has no daylight saving). */
export type Daypart = 'breakfast' | 'lunch' | 'afternoon' | 'evening' | 'late';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function localDayHour(at: Date, timezone = 'Australia/Brisbane'): { dow: (typeof DAYS)[number]; hour: number } {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const wd = (parts.find((p) => p.type === 'weekday')?.value ?? 'Sun').slice(0, 3).toLowerCase();
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  return { dow: (DAYS as readonly string[]).includes(wd) ? (wd as (typeof DAYS)[number]) : 'sun', hour };
}

export function daypart(hour: number): Daypart {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late';
}

/** Keys at two granularities: specific (fri_evening) and general (evening). */
export function contextKeys(at: Date, timezone?: string): string[] {
  const { dow, hour } = localDayHour(at, timezone);
  const dp = daypart(hour);
  return [`ctx:${dow}_${dp}`, `ctx:${dp}`];
}
