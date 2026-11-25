-- Busy mode for the store home: "Busy — add 10/20/30 minutes" for a set time. Customers then see
-- longer ready times (basket estimate and the time promised when an order is accepted), and the time
-- goes back to normal automatically when busy mode ends.

alter table public.restaurant_locations
  add column busy_extra_minutes smallint not null default 0 check (busy_extra_minutes between 0 and 60),
  add column busy_until timestamptz;

-- Prep time right now: the usual prep time plus any busy-mode minutes that haven't expired.
create or replace function public.location_prep_minutes(p_location_id uuid)
returns integer language sql stable set search_path = public as $$
  select l.prep_time_minutes + case when l.busy_until > now() then l.busy_extra_minutes else 0 end
  from public.restaurant_locations l where l.id = p_location_id;
$$;

-- Any team member (like pausing orders). p_extra_minutes = 0 ends busy mode.
create or replace function public.set_location_busy(p_location_id uuid, p_extra_minutes integer, p_for_minutes integer default 60)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_restaurant_member((select restaurant_id from public.restaurant_locations where id = p_location_id)) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  if p_extra_minutes not between 0 and 60 or p_for_minutes not between 15 and 480 then
    raise exception 'Busy mode adds 0–60 minutes for 15 minutes to 8 hours' using errcode = '22023';
  end if;
  update public.restaurant_locations
     set busy_extra_minutes = p_extra_minutes,
         busy_until = case when p_extra_minutes = 0 then null else now() + make_interval(mins => p_for_minutes) end
   where id = p_location_id;
end $$;
revoke all on function public.set_location_busy(uuid, integer, integer) from public, anon;
grant execute on function public.set_location_busy(uuid, integer, integer) to authenticated;

-- Accepting an order (default prep time) now includes busy-mode minutes. Otherwise unchanged.
create or replace function public.restaurant_update_order_status(
  p_order_id uuid, p_status public.order_status, p_note text default null
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if not public.is_restaurant_member(v_order.restaurant_id) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  if p_status not in ('accepted', 'rejected', 'preparing', 'ready', 'completed', 'cancelled') then
    raise exception 'Restaurants cannot set status %', p_status using errcode = '42501';
  end if;
  if p_status in ('rejected', 'cancelled') and coalesce(trim(p_note), '') = '' then
    raise exception 'A reason is required to reject or cancel an order' using errcode = '23514';
  end if;

  update public.orders
     set status = p_status,
         cancel_reason = case when p_status in ('rejected', 'cancelled') then p_note else cancel_reason end,
         estimated_ready_at = case when p_status = 'accepted'
                                   then now() + make_interval(mins => public.location_prep_minutes(v_order.location_id))
                                   else estimated_ready_at end
   where id = p_order_id
   returning * into v_order;

  if p_note is not null then
    update public.order_status_events set note = p_note
     where id = (select max(id) from public.order_status_events where order_id = p_order_id);
  end if;

  if v_order.user_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_order.user_id, 'order_status',
            'Order ' || v_order.order_number || ' ' || replace(p_status::text, '_', ' '),
            p_note, jsonb_build_object('order_id', v_order.id, 'status', p_status));
  end if;
  return v_order;
end $$;
