-- The feed and Crave Match only show videos linked to a verified restaurant, so every video can be
-- ordered from. Videos with no restaurant stay on their creator's profile but leave the feed.

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
    -- Only videos linked to a verified restaurant within the service area: every video in the feed can
    -- be ordered from (a right swipe opens the dish, or the restaurant's menu).
    and r.id is not null and r.status = 'verified'
    and loc.id is not null
    and (loc.distance_km is null or loc.distance_km <= p_max_km)
  order by v.published_at desc
  limit least(greatest(p_limit, 1), 1000);
$$;

create or replace function public.create_crave_room() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_room uuid;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if v_uid is null then raise exception 'Sign in to start a Crave Match' using errcode = '42501'; end if;
  if (select count(*) from public.crave_rooms where host_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many groups started — try again later' using errcode = 'P0001';
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.crave_rooms where code = v_code);
  end loop;
  insert into public.crave_rooms (code, host_id) values (v_code, v_uid) returning id into v_room;
  insert into public.crave_room_members (room_id, user_id) values (v_room, v_uid);
  insert into public.crave_room_videos (room_id, video_id, position)
    select v_room, d.id, row_number() over (order by random())
    from (select v.id from public.videos v
          where v.status = 'published' and v.playback_url is not null
            -- only videos of verified restaurants (every card can be ordered)
            and exists (select 1 from public.restaurants r
                        where r.status = 'verified'
                          and (r.id = v.restaurant_id or exists (select 1 from public.video_menu_items vmi
                                 where vmi.video_id = v.id and vmi.status = 'approved' and vmi.restaurant_id = r.id)))
          order by v.published_at desc nulls last limit 30) d;
  return jsonb_build_object('roomId', v_room, 'code', v_code);
end $$;
