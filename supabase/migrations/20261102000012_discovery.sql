-- Discovery: nearby restaurants, search, and a restaurant's public "video menu".

create or replace function public.nearby_restaurants(
  p_lat double precision default null,
  p_lng double precision default null,
  p_max_km double precision default 15,
  p_query text default null,
  p_limit integer default 50
) returns table (
  restaurant_id uuid, name text, slug text, description text, logo_url text, cover_url text,
  cuisines text[], price_level smallint, halal_certified boolean,
  location_id uuid, suburb text, distance_km double precision, is_open boolean, accepting_orders boolean,
  video_count bigint, matched_items text[]
)
language sql stable security invoker set search_path = public as $$
  with q as (select nullif(trim(lower(p_query)), '') as term),
  base as (
    select r.*, loc.id as loc_id, loc.suburb as loc_suburb, loc.distance_km, loc.is_accepting_orders
    from public.restaurants r
    cross join lateral (
      select rl.id, rl.suburb, rl.is_accepting_orders,
             case when p_lat is null or p_lng is null then null else public.haversine_km(p_lat, p_lng, rl.lat, rl.lng) end as distance_km
      from public.restaurant_locations rl where rl.restaurant_id = r.id
      order by distance_km nulls last limit 1
    ) loc
    where r.status = 'verified'
  )
  select b.id, b.name, b.slug, b.description, b.logo_url, b.cover_url, b.cuisines, b.price_level,
         exists (select 1 from public.restaurant_certifications rc where rc.restaurant_id = b.id
                   and rc.certification = 'halal' and rc.verified_at is not null
                   and (rc.valid_until is null or rc.valid_until >= current_date)),
         b.loc_id, b.loc_suburb, b.distance_km, public.location_is_open(b.loc_id), b.is_accepting_orders,
         (select count(*) from public.videos v
            where v.status = 'published' and (v.restaurant_id = b.id or exists (
              select 1 from public.video_menu_items vmi where vmi.video_id = v.id and vmi.restaurant_id = b.id and vmi.status = 'approved'))),
         (select array_agg(mi.name order by mi.name) from public.menu_items mi, q
            where mi.restaurant_id = b.id and mi.is_available and q.term is not null
              and (mi.name ilike '%' || q.term || '%' or mi.category ilike q.term || '%' or q.term = any (mi.tags)))
  from base b, q
  where (b.distance_km is null or b.distance_km <= p_max_km)
    and (q.term is null
         or b.name ilike '%' || q.term || '%'
         or q.term = any (b.cuisines)
         or b.loc_suburb ilike q.term || '%'
         or exists (select 1 from public.menu_items mi where mi.restaurant_id = b.id and mi.is_available
                      and (mi.name ilike '%' || q.term || '%' or mi.cuisine = q.term or mi.category ilike q.term || '%' or q.term = any (mi.tags))))
  order by b.distance_km nulls last, b.name
  limit least(greatest(p_limit, 1), 200);
$$;
grant execute on function public.nearby_restaurants(double precision, double precision, double precision, text, integer)
  to anon, authenticated, service_role;

-- A restaurant's video menu: each available menu item with its best approved published video, if any.
-- Items without video still appear (photo menu fallback).
create or replace function public.restaurant_video_menu(p_restaurant_id uuid)
returns table (
  menu_item_id uuid, section text, name text, description text, price_cents integer, currency char(3),
  image_url text, dietary_tags text[], spice_level smallint, is_available boolean, sort_order integer,
  video_id uuid, playback_url text, thumbnail_url text, has_options boolean
)
language sql stable security invoker set search_path = public as $$
  select mi.id, mi.section, mi.name, mi.description, mi.price_cents, mi.currency, mi.image_url, mi.dietary_tags,
         mi.spice_level, mi.is_available, mi.sort_order,
         v.id, v.playback_url, v.thumbnail_url,
         exists (select 1 from public.menu_item_option_groups g where g.menu_item_id = mi.id)
  from public.menu_items mi
  join public.restaurants r on r.id = mi.restaurant_id and r.status = 'verified'
  left join lateral (
    select v.id, v.playback_url, v.thumbnail_url
    from public.video_menu_items vmi join public.videos v on v.id = vmi.video_id
    left join public.video_stats s on s.video_id = v.id
    where vmi.menu_item_id = mi.id and vmi.status = 'approved' and v.status = 'published' and v.playback_url is not null
    order by coalesce(s.right_swipes, 0) + coalesce(s.likes, 0) desc, v.published_at desc
    limit 1
  ) v on true
  where mi.restaurant_id = p_restaurant_id
  order by mi.section, mi.sort_order, mi.name;
$$;
grant execute on function public.restaurant_video_menu(uuid) to anon, authenticated, service_role;

-- Restaurant-side view of creator tag requests, with enough context to decide.
create or replace function public.restaurant_tag_requests(p_restaurant_id uuid)
returns table (
  video_id uuid, menu_item_id uuid, menu_item_name text, status public.link_status, requested_at timestamptz,
  caption text, playback_url text, video_status public.video_status, is_sponsored boolean,
  creator_handle text, creator_display_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_restaurant_member(p_restaurant_id) or public.is_admin()) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  return query
  select vmi.video_id, vmi.menu_item_id, mi.name, vmi.status, vmi.created_at, v.caption, v.playback_url, v.status,
         v.is_sponsored, c.handle, pp.display_name
  from public.video_menu_items vmi
  join public.menu_items mi on mi.id = vmi.menu_item_id
  join public.videos v on v.id = vmi.video_id
  left join public.creators c on c.user_id = v.uploader_id
  left join public.public_profiles pp on pp.id = v.uploader_id
  where vmi.restaurant_id = p_restaurant_id
  order by (vmi.status = 'pending') desc, vmi.created_at desc
  limit 200;
end $$;
revoke execute on function public.restaurant_tag_requests(uuid) from public, anon;
grant execute on function public.restaurant_tag_requests(uuid) to authenticated, service_role;
