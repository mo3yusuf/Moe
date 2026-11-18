-- Security: verified restaurants and all creators are publicly readable (customers browse them), but
-- some of their columns are private business data. Row-level security can't hide individual columns,
-- so we narrow the column grants for the API roles and expose the private fields only through
-- guarded functions (own team / the creator themself / admins). Writes are unaffected.

-- Restaurants: public columns only.
revoke select on public.restaurants from anon, authenticated;
grant select (id, name, slug, description, logo_url, cover_url, cuisines, price_level, status,
              accepts_advance_orders, created_by, created_at, updated_at)
  on public.restaurants to anon, authenticated;

-- Private restaurant fields for the restaurant's own team, or admins. Unauthorised ids are skipped.
create or replace function public.restaurants_private(p_ids uuid[])
returns table (id uuid, abn text, legal_name text, commission_rate_bps integer, stripe_account_id text, payouts_enabled boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.abn, r.legal_name, r.commission_rate_bps, r.stripe_account_id, r.payouts_enabled
  from public.restaurants r
  where r.id = any(p_ids)
    and auth.uid() is not null
    and (public.is_admin() or public.is_restaurant_member(r.id));
$$;
revoke all on function public.restaurants_private(uuid[]) from public, anon;
grant execute on function public.restaurants_private(uuid[]) to authenticated;

-- Creators: public profile columns only.
revoke select on public.creators from anon, authenticated;
grant select (user_id, handle, bio, is_verified, created_at) on public.creators to anon, authenticated;

-- Private creator fields for the creator themself, or admins.
create or replace function public.creators_private(p_ids uuid[])
returns table (user_id uuid, affiliate_status text, affiliate_applied_at timestamptz, affiliate_commission_bps integer,
               stripe_account_id text, payouts_enabled boolean)
language sql stable security definer set search_path = public as $$
  select c.user_id, c.affiliate_status::text, c.affiliate_applied_at, c.affiliate_commission_bps, c.stripe_account_id, c.payouts_enabled
  from public.creators c
  where c.user_id = any(p_ids)
    and auth.uid() is not null
    and (public.is_admin() or c.user_id = auth.uid());
$$;
revoke all on function public.creators_private(uuid[]) from public, anon;
grant execute on function public.creators_private(uuid[]) to authenticated;

-- Admin creator list (filterable by affiliate status) for the dashboard.
create or replace function public.admin_list_creators(p_status text default null)
returns table (user_id uuid, handle text, is_verified boolean, affiliate_status text, affiliate_commission_bps integer,
               affiliate_applied_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select c.user_id, c.handle, c.is_verified, c.affiliate_status::text, c.affiliate_commission_bps, c.affiliate_applied_at, c.created_at
    from public.creators c
    where p_status is null or c.affiliate_status::text = p_status
    order by c.affiliate_applied_at desc nulls last, c.created_at desc
    limit 200;
end $$;
revoke all on function public.admin_list_creators(text) from public, anon;
grant execute on function public.admin_list_creators(text) to authenticated;

-- Search runs with the caller's rights, so it must only read public restaurant columns (it used r.*).
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
    select r.id, r.name, r.slug, r.description, r.logo_url, r.cover_url, r.cuisines, r.price_level,
           loc.id as loc_id, loc.suburb as loc_suburb, loc.distance_km, loc.is_accepting_orders
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
