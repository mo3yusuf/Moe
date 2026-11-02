-- Feed candidate retrieval and atomic stats updates.

-- One row per published video with the facts the ranking engine needs. Orderability is computed
-- here (verified restaurant, approved menu link, item available, location open & accepting,
-- pickup enabled) so the client never decides what can be ordered.
create or replace function public.feed_candidates(
  p_city_id uuid default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_max_km double precision default 30,
  p_limit integer default 300
) returns table (
  video_id uuid, playback_url text, thumbnail_url text, duration_ms integer, caption text, hashtags text[],
  is_sponsored boolean, sponsor_disclosure text, published_at timestamptz, source public.video_source,
  uploader_id uuid, creator_handle text, creator_display_name text,
  restaurant_id uuid, restaurant_name text, restaurant_slug text, cuisines text[], price_level smallint, halal_certified boolean,
  location_id uuid, suburb text, distance_km double precision, is_open boolean, accepting_orders boolean, pickup_enabled boolean,
  menu_item_id uuid, menu_item_name text, price_cents integer, currency char(3), item_cuisine text, item_category text,
  item_tags text[], dietary_tags text[], spice_level smallint, item_available boolean, orderable boolean,
  likes bigint, comments bigint, impressions bigint, completions bigint, right_swipes bigint, left_swipes bigint, orders bigint
)
language sql stable security invoker set search_path = public as $$
  with links as (
    select distinct on (vmi.video_id) vmi.video_id, vmi.menu_item_id
    from public.video_menu_items vmi
    where vmi.status = 'approved'
    order by vmi.video_id, vmi.is_primary desc, vmi.created_at
  )
  select
    v.id, v.playback_url, v.thumbnail_url, v.duration_ms, v.caption, v.hashtags,
    v.is_sponsored, v.sponsor_disclosure, v.published_at, v.source,
    v.uploader_id, c.handle, pp.display_name,
    r.id, r.name, r.slug, r.cuisines, r.price_level,
    exists (select 1 from public.restaurant_certifications rc
            where rc.restaurant_id = r.id and rc.certification = 'halal' and rc.verified_at is not null
              and (rc.valid_until is null or rc.valid_until >= current_date)),
    loc.id, loc.suburb, loc.distance_km,
    coalesce(public.location_is_open(loc.id), false), coalesce(loc.is_accepting_orders, false), coalesce(loc.pickup_enabled, false),
    mi.id, mi.name, mi.price_cents, mi.currency, mi.cuisine, mi.category, mi.tags, mi.dietary_tags, mi.spice_level,
    coalesce(mi.is_available, false),
    (mi.id is not null and mi.is_available and loc.id is not null and loc.is_accepting_orders and loc.pickup_enabled
       and public.location_is_open(loc.id)),
    coalesce(s.likes, 0), coalesce(s.comments, 0), coalesce(s.impressions, 0), coalesce(s.completions, 0),
    coalesce(s.right_swipes, 0), coalesce(s.left_swipes, 0), coalesce(s.orders, 0)
  from public.videos v
  left join links l on l.video_id = v.id
  left join public.menu_items mi on mi.id = l.menu_item_id
  left join public.restaurants r on r.id = coalesce(mi.restaurant_id, v.restaurant_id)
  left join public.creators c on c.user_id = v.uploader_id
  left join public.public_profiles pp on pp.id = v.uploader_id
  left join public.video_stats s on s.video_id = v.id
  left join lateral (
    select rl.id, rl.suburb, rl.is_accepting_orders, rl.pickup_enabled,
           case when p_lat is null or p_lng is null then null
                else public.haversine_km(p_lat, p_lng, rl.lat, rl.lng) end as distance_km
    from public.restaurant_locations rl
    where rl.restaurant_id = r.id
      and (p_city_id is null or rl.city_id = p_city_id)
    order by distance_km nulls last
    limit 1
  ) loc on true
  where v.status = 'published'
    and v.playback_url is not null
    -- Restaurant-linked content only from verified restaurants, within the service area.
    and (r.id is null or r.status = 'verified')
    and (r.id is null or loc.id is not null)
    and (loc.distance_km is null or loc.distance_km <= p_max_km)
  order by v.published_at desc
  limit least(greatest(p_limit, 1), 1000);
$$;

grant execute on function public.feed_candidates(uuid, double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- Atomic counter updates for aggregated, non-personal video statistics. Backend only.
create or replace function public.bump_video_stats(
  p_video_id uuid,
  p_impressions integer default 0, p_views_3s integer default 0, p_completions integer default 0,
  p_shares integer default 0, p_right_swipes integer default 0, p_left_swipes integer default 0,
  p_order_clicks integer default 0
) returns void language sql security definer set search_path = public as $$
  insert into public.video_stats (video_id, impressions, views_3s, completions, shares, right_swipes, left_swipes, order_clicks)
  values (p_video_id, greatest(p_impressions, 0), greatest(p_views_3s, 0), greatest(p_completions, 0),
          greatest(p_shares, 0), greatest(p_right_swipes, 0), greatest(p_left_swipes, 0), greatest(p_order_clicks, 0))
  on conflict (video_id) do update set
    impressions  = video_stats.impressions + excluded.impressions,
    views_3s     = video_stats.views_3s + excluded.views_3s,
    completions  = video_stats.completions + excluded.completions,
    shares       = video_stats.shares + excluded.shares,
    right_swipes = greatest(video_stats.right_swipes + p_right_swipes, 0),
    left_swipes  = greatest(video_stats.left_swipes + p_left_swipes, 0),
    order_clicks = video_stats.order_clicks + excluded.order_clicks,
    updated_at   = now();
$$;
revoke execute on function public.bump_video_stats(uuid, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.bump_video_stats(uuid, integer, integer, integer, integer, integer, integer, integer) to service_role;
