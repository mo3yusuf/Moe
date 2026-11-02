-- Ranking inputs: one flat, feature-rich row per behavioural signal for a user.
-- Respects Reset My Taste Profile (taste_reset_at) and a look-back window.
create or replace function public.user_ranking_signals(p_user_id uuid, p_since timestamptz default now() - interval '120 days')
returns table (
  kind text, at timestamptz, video_id uuid, menu_item_id uuid,
  restaurant_id uuid, cuisine text, category text, tags text[], price_level smallint, price_cents integer,
  creator_id uuid, halal_certified boolean, watch_ms integer, completion_pct smallint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_since timestamptz;
begin
  -- Users may read their own signals (transparency); only the backend may read anyone's.
  if not public.request_is_privileged() and p_user_id is distinct from auth.uid() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select greatest(p_since, coalesce(taste_reset_at, '-infinity'::timestamptz)) into v_since
  from public.profiles where id = p_user_id;
  v_since := coalesce(v_since, p_since);

  return query
  with raw as (
    select case s.direction when 'right' then 'right_swipe' else 'left_swipe' end as kind, s.created_at as at,
           s.video_id, s.menu_item_id, null::integer as watch_ms, null::smallint as completion_pct
    from public.swipe_events s where s.user_id = p_user_id and s.created_at > v_since
    union all
    select case i.event_type::text when 'menu_item_click' then 'menu_item_click' when 'order_click' then 'order_click'
                when 'add_to_basket' then 'add_to_basket' when 'replay' then 'replay' else 'watch' end,
           i.created_at, i.video_id, i.menu_item_id, i.watch_ms, i.completion_pct
    from public.video_interactions i
    where i.user_id = p_user_id and i.created_at > v_since
      and i.event_type in ('watch', 'replay', 'menu_item_click', 'order_click', 'add_to_basket')
    union all
    select 'like', l.created_at, l.video_id, null, null, null
    from public.video_likes l where l.user_id = p_user_id and l.created_at > v_since
    union all
    select 'save', sm.created_at, sm.video_id, sm.menu_item_id, null, null
    from public.saved_meals sm where sm.user_id = p_user_id and sm.collection = 'saved' and sm.created_at > v_since
    union all
    -- Orders that went through (placed or later, not rejected/cancelled/failed).
    select 'order', coalesce(o.placed_at, o.created_at), oi.source_video_id, oi.menu_item_id, null, null
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.user_id = p_user_id and coalesce(o.placed_at, o.created_at) > v_since
      and o.status in ('placed', 'accepted', 'preparing', 'ready', 'completed')
  ),
  resolved as (
    -- Prefer the explicit menu item; fall back to the video's primary approved link.
    select r.*, coalesce(r.menu_item_id, (
      select vmi.menu_item_id from public.video_menu_items vmi
      where vmi.video_id = r.video_id and vmi.status = 'approved'
      order by vmi.is_primary desc limit 1)) as item_id
    from raw r
  )
  select rs.kind, rs.at, rs.video_id, rs.item_id,
         mi.restaurant_id, coalesce(mi.cuisine, rest.cuisines[1]), mi.category, mi.tags, rest.price_level, mi.price_cents,
         case when v.source = 'restaurant' then null else v.uploader_id end,
         exists (select 1 from public.restaurant_certifications rc where rc.restaurant_id = rest.id
                   and rc.certification = 'halal' and rc.verified_at is not null),
         rs.watch_ms, rs.completion_pct
  from resolved rs
  left join public.menu_items mi on mi.id = rs.item_id
  left join public.restaurants rest on rest.id = mi.restaurant_id
  left join public.videos v on v.id = rs.video_id
  order by rs.at;
end $$;

revoke execute on function public.user_ranking_signals(uuid, timestamptz) from public, anon;
grant execute on function public.user_ranking_signals(uuid, timestamptz) to authenticated, service_role;
