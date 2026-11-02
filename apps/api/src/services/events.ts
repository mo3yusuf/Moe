import {
  classifyWatch,
  applySignal,
  searchFeatures,
  type InteractionEvent,
  type MealFeatures,
  type RecommendationConfig,
  type SignalType,
  type TasteProfile,
} from '@crave/core';
import type { Sql, Tx } from '../db';
import { activeRecommendationConfig } from './config';
import { lockTasteProfile, personalisationEnabled, saveTasteProfile } from './taste';

interface FeatureRow {
  video_id: string;
  uploader_id: string;
  uploader_kind: 'creator' | 'restaurant';
  hashtags: string[];
  menu_item_id: string | null;
  restaurant_id: string | null;
  cuisine: string | null;
  restaurant_cuisines: string[] | null;
  food_category: string | null;
  tags: string[] | null;
  price_cents: number | null;
}

async function videoFeatures(tx: Tx, videoIds: string[]): Promise<Map<string, MealFeatures>> {
  if (videoIds.length === 0) return new Map();
  const rows = await tx<FeatureRow[]>`
    select v.id as video_id, v.uploader_id, v.uploader_kind, v.hashtags,
           mi.id as menu_item_id, r.id as restaurant_id, mi.cuisine, r.cuisines as restaurant_cuisines,
           mi.food_category, mi.tags, mi.price_cents
    from public.videos v
    left join public.video_menu_items l on l.video_id = v.id and l.is_primary and l.status = 'approved'
    left join public.menu_items mi on mi.id = l.menu_item_id
    left join public.restaurants r on r.id = coalesce(l.restaurant_id, v.restaurant_id)
    where v.id in ${tx(videoIds)}`;
  return new Map(
    rows.map((r) => [
      r.video_id,
      {
        videoId: r.video_id,
        menuItemId: r.menu_item_id,
        restaurantId: r.restaurant_id,
        creatorId: r.uploader_kind === 'creator' ? r.uploader_id : null,
        cuisines: r.cuisine ? [r.cuisine] : r.restaurant_cuisines ?? [],
        category: r.food_category,
        tags: [...new Set([...(r.tags ?? []), ...r.hashtags])],
        priceCents: r.price_cents,
      },
    ]),
  );
}

/** Maps a client event to a learning signal (null = logged but not learned from). */
export function signalFor(e: InteractionEvent): SignalType | null {
  switch (e.type) {
    case 'watch':
      return classifyWatch({ watchedMs: e.watchedMs ?? 0, durationMs: e.durationMs ?? 0, loops: e.loops ?? 0 });
    case 'crave_swipe':
    case 'not_for_me_swipe':
    case 'like':
    case 'save_meal':
    case 'unsave_meal':
    case 'share':
    case 'comment':
    case 'menu_item_click':
    case 'add_to_basket':
    case 'search':
    case 'follow_restaurant':
    case 'follow_creator':
      return e.type;
    default:
      return null; // impression, unlike
  }
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  learned: number;
  personalisation: boolean;
}

/**
 * Ingests a batch of interaction events for one user:
 *   1. Applies side effects that must happen regardless of personalisation
 *      (Cravings collection on right swipe / save, likes).
 *   2. If personalisation is enabled: logs events (idempotently, by clientEventId)
 *      and updates the taste profile inside one transaction.
 */
export async function ingestEvents(sql: Sql, userId: string, events: InteractionEvent[], now = new Date()): Promise<IngestResult> {
  const config: RecommendationConfig = await activeRecommendationConfig(sql);
  const personalised = await personalisationEnabled(sql, userId);
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return sql.begin(async (tx) => {
    // Only accept events for videos that exist and are visible.
    const videoIds = [...new Set(sorted.map((e) => e.videoId).filter((v): v is string => !!v))];
    const visible = new Set(
      videoIds.length
        ? (await tx<{ id: string }[]>`select id from public.videos where id in ${tx(videoIds)} and status = 'published'`).map((r) => r.id)
        : [],
    );
    const valid = sorted.filter((e) => !e.videoId || visible.has(e.videoId));

    // --- Side effects (always) ------------------------------------------------
    for (const e of valid) {
      if (!e.videoId) continue;
      if (e.type === 'crave_swipe' || e.type === 'save_meal') {
        const [link] = await tx<{ menu_item_id: string }[]>`
          select menu_item_id from public.video_menu_items where video_id = ${e.videoId} and is_primary and status = 'approved'`;
        await tx`
          insert into public.saved_meals (user_id, video_id, menu_item_id, source)
          values (${userId}, ${e.videoId}, ${link?.menu_item_id ?? null}, ${e.type === 'crave_swipe' ? 'crave_swipe' : 'save_button'})
          on conflict do nothing`;
      } else if (e.type === 'unsave_meal') {
        await tx`delete from public.saved_meals where user_id = ${userId} and video_id = ${e.videoId}`;
      } else if (e.type === 'like') {
        await tx`insert into public.video_likes (user_id, video_id) values (${userId}, ${e.videoId}) on conflict do nothing`;
      } else if (e.type === 'unlike') {
        await tx`delete from public.video_likes where user_id = ${userId} and video_id = ${e.videoId}`;
      } else if (e.type === 'share') {
        await tx`update public.videos set share_count = share_count + 1 where id = ${e.videoId}`;
      } else if (e.type === 'watch') {
        await tx`update public.videos set view_count = view_count + 1 where id = ${e.videoId}`;
      }
    }

    if (!personalised) {
      return { accepted: valid.length, duplicates: 0, learned: 0, personalisation: false };
    }

    // --- Idempotent event log --------------------------------------------------
    const rows = valid.map((e) => ({
      user_id: userId,
      client_event_id: e.clientEventId,
      event_type: e.type,
      video_id: e.videoId ?? null,
      menu_item_id: e.menuItemId ?? null,
      restaurant_id: e.restaurantId ?? null,
      watch_signal: e.type === 'watch' ? signalFor(e) : null,
      watched_ms: e.watchedMs ?? null,
      duration_ms: e.durationMs ?? null,
      loops: e.loops ?? null,
      feed_position: e.position ?? null,
      feed_session_id: e.feedSessionId ?? null,
      search_query: e.type === 'search' ? (e.query ?? '').slice(0, 80) : null,
      occurred_at: new Date(e.occurredAt) > now ? now : new Date(e.occurredAt),
    }));
    const inserted = rows.length
      ? await tx<{ client_event_id: string }[]>`
          insert into public.video_interactions ${tx(rows)}
          on conflict (user_id, client_event_id) do nothing
          returning client_event_id`
      : [];
    const fresh = new Set(inserted.map((r) => r.client_event_id));
    const toLearn = valid.filter((e) => fresh.has(e.clientEventId));

    // Swipe log mirrors explicit swipes.
    const swipes = toLearn.filter((e) => e.videoId && (e.type === 'crave_swipe' || e.type === 'not_for_me_swipe'));
    if (swipes.length) {
      await tx`insert into public.swipe_events ${tx(
        swipes.map((e) => ({
          user_id: userId,
          video_id: e.videoId!,
          menu_item_id: e.menuItemId ?? null,
          direction: e.type === 'crave_swipe' ? 'right' : 'left',
          feed_session_id: e.feedSessionId ?? null,
        })),
      )}`;
    }

    // --- Taste profile update -------------------------------------------------
    const features = await videoFeatures(tx, [...new Set(toLearn.map((e) => e.videoId).filter((v): v is string => !!v))]);
    let knownTags: string[] = [];
    let knownCuisines: string[] = [];
    if (toLearn.some((e) => e.type === 'search')) {
      knownTags = (await tx<{ t: string }[]>`select distinct unnest(tags) as t from public.menu_items where archived_at is null`).map((r) => r.t);
      knownCuisines = (await tx<{ c: string }[]>`select distinct cuisine as c from public.menu_items where cuisine is not null`).map((r) => r.c);
    }

    const { profile: start } = await lockTasteProfile(tx, userId, config.version);
    let profile: TasteProfile = start;
    let learned = 0;
    for (const e of toLearn) {
      const signal = signalFor(e);
      if (!signal) continue;
      const f = e.type === 'search' ? searchFeatures(e.query ?? '', knownTags, knownCuisines) : e.videoId ? features.get(e.videoId) : undefined;
      if (!f) continue;
      const at = new Date(e.occurredAt) > now ? now : new Date(e.occurredAt);
      profile = applySignal(profile, signal, f, { at, timeZone: 'Australia/Brisbane' }, config);
      learned += 1;
    }
    if (learned > 0) await saveTasteProfile(tx, userId, profile, config.version);

    return { accepted: valid.length, duplicates: valid.length - fresh.size, learned, personalisation: true };
  });
}
