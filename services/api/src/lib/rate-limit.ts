import type { MiddlewareHandler } from 'hono';
import { ApiError } from './errors';

/**
 * In-memory token-bucket rate limiter, keyed by user (or IP for unauthenticated routes).
 * Good for a single API instance in a pilot; use a shared store (Redis / edge rate limiting) when
 * running multiple instances.
 */
export function rateLimit(opts: { name: string; capacity: number; refillPerSecond: number; key: (c: Parameters<MiddlewareHandler>[0]) => string; now?: () => number }): MiddlewareHandler {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const now = opts.now ?? (() => Date.now());
  return async (c, next) => {
    const k = `${opts.name}:${opts.key(c)}`;
    const t = now();
    const b = buckets.get(k) ?? { tokens: opts.capacity, at: t };
    b.tokens = Math.min(opts.capacity, b.tokens + ((t - b.at) / 1000) * opts.refillPerSecond);
    b.at = t;
    if (b.tokens < 1) {
      c.header('Retry-After', String(Math.ceil((1 - b.tokens) / opts.refillPerSecond)));
      throw new ApiError(429, 'rate_limited', 'Too many requests — please slow down');
    }
    b.tokens -= 1;
    buckets.set(k, b);
    if (buckets.size > 50_000) for (const [key, v] of buckets) if (t - v.at > 600_000) buckets.delete(key);
    await next();
  };
}

export const clientIp = (c: Parameters<MiddlewareHandler>[0]) =>
  c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
