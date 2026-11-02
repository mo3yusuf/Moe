import { z } from 'zod';

const uuid = z.uuid();

const Swipe = z.object({
  kind: z.literal('swipe'),
  videoId: uuid,
  menuItemId: uuid.nullish(),
  direction: z.enum(['right', 'left']),
  inputMethod: z.enum(['gesture', 'button', 'accessibility_action']),
  feedRequestId: uuid.nullish(),
});

const Interaction = z.object({
  kind: z.literal('interaction'),
  eventType: z.enum(['impression', 'watch', 'replay', 'share', 'menu_item_click', 'order_click', 'add_to_basket', 'restaurant_click']),
  videoId: uuid,
  menuItemId: uuid.nullish(),
  watchMs: z.number().int().min(0).max(3_600_000).optional(),
  completionPct: z.number().int().min(0).max(100).optional(),
  feedRequestId: uuid.nullish(),
});

/** Explicit user actions that change user-owned state (likes, bookmarks). Not behavioural tracking. */
const Action = z.object({
  kind: z.literal('action'),
  action: z.enum(['like', 'unlike', 'save', 'unsave']),
  videoId: uuid,
  menuItemId: uuid.nullish(),
});

export const IncomingEvent = z.object({
  clientEventId: uuid,
  occurredAt: z.iso.datetime(),
  payload: z.discriminatedUnion('kind', [Swipe, Interaction, Action]),
});
export const EventBatch = z.object({ events: z.array(IncomingEvent).min(1).max(100) });
export type IncomingEvent = z.infer<typeof IncomingEvent>;

export interface StatDelta {
  impressions: number; views3s: number; completions: number; shares: number;
  rightSwipes: number; leftSwipes: number; orderClicks: number;
}

export interface EventWritePlan {
  swipes: { clientEventId: string; videoId: string; menuItemId: string | null; direction: 'right' | 'left'; inputMethod: string; feedRequestId: string | null; createdAt: string }[];
  interactions: { clientEventId: string; videoId: string; menuItemId: string | null; eventType: string; watchMs: number | null; completionPct: number | null; feedRequestId: string | null; createdAt: string }[];
  cravingsAdd: { videoId: string; menuItemId: string | null }[];
  cravingsRemove: string[]; // video ids
  likesAdd: string[];
  likesRemove: string[];
  savedAdd: { videoId: string; menuItemId: string | null }[];
  savedRemove: string[];
  stats: Map<string, StatDelta>;
}

const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Decides what to persist for a batch of client events.
 *  - Behavioural signals (impressions, watch time, swipes) are stored per-user ONLY with
 *    personalisation consent. Without consent we still update anonymous aggregate counters and
 *    honour explicit actions (Cravings, likes, saves) because those are features the user asked for.
 *  - Client timestamps are clamped: future or very old timestamps are replaced with server time.
 *  - Within a batch, the latest swipe per video decides Cravings membership.
 */
export function planEventWrites(
  events: IncomingEvent[],
  opts: { personalisation: boolean; now: Date; previousSwipes?: Map<string, 'right' | 'left'> },
): EventWritePlan {
  const plan: EventWritePlan = {
    swipes: [], interactions: [], cravingsAdd: [], cravingsRemove: [],
    likesAdd: [], likesRemove: [], savedAdd: [], savedRemove: [], stats: new Map(),
  };
  const nowMs = opts.now.getTime();
  const stat = (videoId: string) => {
    let s = plan.stats.get(videoId);
    if (!s) plan.stats.set(videoId, (s = { impressions: 0, views3s: 0, completions: 0, shares: 0, rightSwipes: 0, leftSwipes: 0, orderClicks: 0 }));
    return s;
  };
  const latestSwipe = new Map<string, { direction: 'right' | 'left'; menuItemId: string | null }>();

  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const e of ordered) {
    const t = Date.parse(e.occurredAt);
    const createdAt = (t > nowMs + MAX_CLOCK_SKEW_MS || t < nowMs - MAX_EVENT_AGE_MS ? opts.now : new Date(t)).toISOString();
    const p = e.payload;
    switch (p.kind) {
      case 'swipe': {
        if (opts.personalisation) {
          plan.swipes.push({ clientEventId: e.clientEventId, videoId: p.videoId, menuItemId: p.menuItemId ?? null, direction: p.direction, inputMethod: p.inputMethod, feedRequestId: p.feedRequestId ?? null, createdAt });
        }
        const prevDir = latestSwipe.get(p.videoId)?.direction ?? opts.previousSwipes?.get(p.videoId);
        const prev = prevDir ? { direction: prevDir } : undefined;
        if (prev?.direction !== p.direction) {
          const s = stat(p.videoId);
          if (p.direction === 'right') { s.rightSwipes += 1; if (prev) s.leftSwipes -= 1; }
          else { s.leftSwipes += 1; if (prev) s.rightSwipes -= 1; }
        }
        latestSwipe.set(p.videoId, { direction: p.direction, menuItemId: p.menuItemId ?? null });
        break;
      }
      case 'interaction': {
        if (opts.personalisation) {
          plan.interactions.push({
            clientEventId: e.clientEventId, videoId: p.videoId, menuItemId: p.menuItemId ?? null, eventType: p.eventType,
            watchMs: p.watchMs ?? null, completionPct: p.completionPct ?? null, feedRequestId: p.feedRequestId ?? null, createdAt,
          });
        }
        const s = stat(p.videoId);
        if (p.eventType === 'impression') s.impressions += 1;
        if (p.eventType === 'watch' && (p.watchMs ?? 0) >= 3000) s.views3s += 1;
        if (p.eventType === 'watch' && (p.completionPct ?? 0) >= 95) s.completions += 1;
        if (p.eventType === 'share') s.shares += 1;
        if (p.eventType === 'order_click') s.orderClicks += 1;
        break;
      }
      case 'action': {
        const target = { videoId: p.videoId, menuItemId: p.menuItemId ?? null };
        if (p.action === 'like') { plan.likesAdd.push(p.videoId); plan.likesRemove = plan.likesRemove.filter((v) => v !== p.videoId); }
        if (p.action === 'unlike') { plan.likesRemove.push(p.videoId); plan.likesAdd = plan.likesAdd.filter((v) => v !== p.videoId); }
        if (p.action === 'save') { plan.savedAdd.push(target); plan.savedRemove = plan.savedRemove.filter((v) => v !== p.videoId); }
        if (p.action === 'unsave') { plan.savedRemove.push(p.videoId); plan.savedAdd = plan.savedAdd.filter((s) => s.videoId !== p.videoId); }
        break;
      }
    }
  }
  for (const [videoId, s] of latestSwipe) {
    if (s.direction === 'right') plan.cravingsAdd.push({ videoId, menuItemId: s.menuItemId });
    else plan.cravingsRemove.push(videoId);
  }
  return plan;
}
