-- "Sold out today" (Uber Eats style): the dish comes back by itself at the start of the next Brisbane
-- day. sold_out_until is null for "sold out until I turn it back on". The API worker brings dishes
-- back once their time has passed (restore_sold_out_items, every minute).

alter table public.menu_items add column sold_out_until timestamptz;

create or replace function public.set_menu_item_sold_out(p_menu_item_id uuid, p_sold_out boolean, p_until_tomorrow boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_restaurant_member((select restaurant_id from public.menu_items where id = p_menu_item_id)) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  update public.menu_items
     set is_available = not p_sold_out,
         -- next midnight in Brisbane (no daylight saving)
         sold_out_until = case when p_sold_out and p_until_tomorrow
                               then (date_trunc('day', now() at time zone 'Australia/Brisbane') + interval '1 day') at time zone 'Australia/Brisbane'
                               else null end
   where id = p_menu_item_id;
end $$;
revoke all on function public.set_menu_item_sold_out(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_menu_item_sold_out(uuid, boolean, boolean) to authenticated;

-- Server only (the API worker).
create or replace function public.restore_sold_out_items() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.request_is_privileged() then raise exception 'Server only' using errcode = '42501'; end if;
  update public.menu_items set is_available = true, sold_out_until = null
   where sold_out_until is not null and sold_out_until <= now() and not is_available;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.restore_sold_out_items() from public, anon, authenticated;

-- Turning a dish back on by hand (old toggle) also clears any "back tomorrow" time.
create or replace function public.set_menu_item_availability(p_menu_item_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_restaurant_member((select restaurant_id from public.menu_items where id = p_menu_item_id)) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  update public.menu_items set is_available = p_available, sold_out_until = null where id = p_menu_item_id;
end $$;
