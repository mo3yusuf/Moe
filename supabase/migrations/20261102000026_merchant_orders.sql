-- Merchant orders screen: accept with a chosen prep time, and live updates.

-- Accept an order and promise it ready in p_prep_minutes (the tablet's 10 / 15 / 20 / 30 min buttons).
-- Same rules as restaurant_update_order_status (restaurant team only, valid state change, customer
-- notified); only the promised ready time differs from the location's default prep time.
create or replace function public.restaurant_accept_order(p_order_id uuid, p_prep_minutes integer)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_status public.order_status;
begin
  if not public.is_restaurant_member((select o.restaurant_id from public.orders o where o.id = p_order_id)) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  if p_prep_minutes is null or p_prep_minutes not between 1 and 240 then
    raise exception 'Prep time must be between 1 and 240 minutes' using errcode = '22023';
  end if;
  -- Only new orders can be accepted (a second tablet tapping Accept must not reset the ready time).
  select o.status into v_status from public.orders o where o.id = p_order_id for update; -- one tablet at a time
  if v_status <> 'placed' then
    raise exception 'This order has already been handled' using errcode = '55000';
  end if;
  perform public.restaurant_update_order_status(p_order_id, 'accepted', null);
  update public.orders set estimated_ready_at = now() + make_interval(mins => p_prep_minutes)
   where id = p_order_id returning * into v_order;
  return v_order;
end $$;
revoke all on function public.restaurant_accept_order(uuid, integer) from public, anon;
grant execute on function public.restaurant_accept_order(uuid, integer) to authenticated;

-- Live order screen: stream order changes to the restaurant's open dashboards (Supabase Realtime
-- applies the same row-level security, so each restaurant only receives its own orders).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
