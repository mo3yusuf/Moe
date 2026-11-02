import { isOpenAt, orderability, type DayOfWeek, type NotOrderableReason, type OpeningPeriod } from '@crave/core';
import type { Sql, Tx } from '../db';

/** One published video joined with its (approved) featured dish and active restaurant. */
export interface VideoRow {
  video_id: string;
  uploader_id: string;
  uploader_kind: 'creator' | 'restaurant';
  uploader_display_name: string | null;
  uploader_username: string | null;
  uploader_avatar_url: string | null;
  playback_url: string | null;
  poster_url: string | null;
  duration_ms: number | null;
  caption: string;
  hashtags: string[];
  is_sponsored: boolean;
  sponsor_disclosure: string | null;
  is_demo: boolean;
  like_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  published_at: Date;
  trending_score: number | null;
  // Featured dish (approved link + active restaurant only)
  menu_item_id: string | null;
  item_name: string | null;
  item_image_url: string | null;
  price_cents: number | null;
  currency: string | null;
  item_available: boolean | null;
  item_cuisine: string | null;
  food_category: string | null;
  item_tags: string[] | null;
  item_dietary: string[] | null;
  spice_level: number | null;
  // Restaurant (active only)
  restaurant_id: string | null;
  restaurant_name: string | null;
  restaurant_slug: string | null;
  restaurant_cuisines: string[] | null;
  restaurant_verified_dietary: string[] | null;
  rating_avg: string | null;
  rating_count: number | null;
  accepting_orders: boolean | null;
  pickup_enabled: boolean | null;
  accepts_advance_orders: boolean | null;
  location_id: string | null;
  suburb: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  hours: { day: number; opens: string; closes: string }[] | null;
  closed_today: boolean | null;
}

/**
 * Candidate query. Only APPROVED video→menu links and ACTIVE restaurants are
 * exposed: an unverified tag must never show a dish/restaurant as orderable.
 */
export async function loadVideoRows(
  sql: Sql | Tx,
  opts: { marketId: string; videoIds?: string[]; limit?: number; uploaderIds?: string[]; restaurantIds?: string[] },
): Promise<VideoRow[]> {
  const limit = opts.limit ?? 500;
  return sql<VideoRow[]>`
    with base as (
      select v.* from public.videos v
      where v.status = 'published' and v.market_id = ${opts.marketId}
        ${opts.videoIds ? sql`and v.id in ${sql(opts.videoIds)}` : sql``}
      order by v.published_at desc
      limit ${limit}
    )
    select
      v.id as video_id, v.uploader_id, v.uploader_kind,
      p.display_name as uploader_display_name, p.username as uploader_username, p.avatar_url as uploader_avatar_url,
      v.playback_url, v.poster_url, v.duration_ms, v.caption, v.hashtags, v.is_sponsored, v.sponsor_disclosure, v.is_demo,
      v.like_count, v.comment_count, v.save_count, v.share_count, v.published_at,
      ts.score as trending_score,
      case when r.id is not null then mi.id end as menu_item_id,
      case when r.id is not null then mi.name end as item_name,
      case when r.id is not null then mi.image_url end as item_image_url,
      case when r.id is not null then mi.price_cents end as price_cents,
      case when r.id is not null then mi.currency end as currency,
      case when r.id is not null then (mi.is_available and mi.archived_at is null) end as item_available,
      mi.cuisine as item_cuisine, mi.food_category, mi.tags as item_tags, mi.dietary_attributes as item_dietary, mi.spice_level,
      r.id as restaurant_id, r.name as restaurant_name, r.slug as restaurant_slug, r.cuisines as restaurant_cuisines,
      r.verified_dietary as restaurant_verified_dietary, r.rating_avg::text as rating_avg, r.rating_count,
      r.accepting_orders, r.pickup_enabled, r.accepts_advance_orders,
      loc.id as location_id, loc.suburb, loc.lat, loc.lng, loc.timezone,
      (select json_agg(json_build_object('day', h.day_of_week, 'opens', to_char(h.opens_at, 'HH24:MI'), 'closes', to_char(h.closes_at, 'HH24:MI')))
         from public.opening_hours h where h.location_id = loc.id) as hours,
      exists (select 1 from public.special_closures sc
              where sc.location_id = loc.id and sc.closed_on = (now() at time zone coalesce(loc.timezone, 'Australia/Brisbane'))::date) as closed_today
    from base v
    join public.profiles p on p.id = v.uploader_id
    left join public.video_trending_scores ts on ts.video_id = v.id
    left join public.video_menu_items l on l.video_id = v.id and l.is_primary and l.status = 'approved'
    left join public.menu_items mi on mi.id = l.menu_item_id
    left join public.restaurants r on r.id = coalesce(l.restaurant_id, v.restaurant_id) and r.status = 'active'
    left join public.restaurant_locations loc on loc.restaurant_id = r.id and loc.is_primary
    where true
      ${opts.uploaderIds || opts.restaurantIds
        ? sql`and (v.uploader_id in ${sql(opts.uploaderIds?.length ? opts.uploaderIds : ['00000000-0000-0000-0000-000000000000'])}
               or r.id in ${sql(opts.restaurantIds?.length ? opts.restaurantIds : ['00000000-0000-0000-0000-000000000000'])})`
        : sql``}
    order by v.published_at desc`;
}

export function periodsFromRow(row: Pick<VideoRow, 'hours'>): OpeningPeriod[] {
  return (row.hours ?? []).map((h) => ({ dayOfWeek: h.day as DayOfWeek, opensAt: h.opens, closesAt: h.closes }));
}

export function rowOrderability(row: VideoRow, now: Date): { orderable: boolean; reason: NotOrderableReason | null; openNow: boolean } {
  if (!row.restaurant_id || !row.menu_item_id) return { orderable: false, reason: null, openNow: false };
  const openNow = !row.closed_today && isOpenAt(periodsFromRow(row), now, row.timezone ?? 'Australia/Brisbane');
  const result = orderability({
    restaurantStatus: 'active',
    acceptingOrders: !!row.accepting_orders,
    pickupEnabled: !!row.pickup_enabled,
    isOpenNow: openNow,
    acceptsAdvanceOrders: !!row.accepts_advance_orders,
    itemAvailable: !!row.item_available,
    linkApproved: true,
  });
  return result.orderable ? { orderable: true, reason: null, openNow } : { orderable: false, reason: result.reason, openNow };
}

export async function marketIdForCode(sql: Sql | Tx, code = 'au-bne'): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from public.markets where code = ${code} and is_active`;
  if (!row) throw new Error(`Market ${code} is not active`);
  return row.id;
}
