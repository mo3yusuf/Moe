-- Phase 8: creator rewards, collaborative recommendations, delivery.

-- ===================================================================================
-- Creator commissions
-- Lifecycle: order completed → pending; after the refund window with no refund/dispute → approved;
-- transferred to the creator's Stripe account → paid. Any refund or dispute before payout → void.
-- Funded from CRAVE's commission on that order and never more than it.
-- ===================================================================================
alter table public.creators add column payouts_enabled boolean not null default false;
alter table public.creator_commissions add column provider_transfer_id text unique;
alter table public.creator_commissions add column approved_at timestamptz;
alter table public.creator_commissions add column paid_at timestamptz;
alter table public.creator_commissions add column void_reason text;
create index creator_commissions_status_idx on public.creator_commissions (status, created_at);

-- Creators must not change payout flags themselves (extends the Phase 4 protection trigger).
create or replace function public.protect_creator_payouts() returns trigger
language plpgsql as $$
begin
  if not public.request_is_privileged() and not public.is_admin()
     and new.payouts_enabled is distinct from old.payouts_enabled then
    raise exception 'Payout status is set by the payment provider' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger creators_protect_payouts before update on public.creators
  for each row execute function public.protect_creator_payouts();

create or replace function public.create_creator_commission() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.creator_attributions; c public.creators; v_amount integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select * into a from public.creator_attributions where order_id = new.id;
    if not found or a.creator_id is null then return null; end if;
    select * into c from public.creators where user_id = a.creator_id;
    if c.affiliate_status <> 'approved' or c.affiliate_commission_bps is null then return null; end if;
    v_amount := least(round(a.attributed_revenue_cents * c.affiliate_commission_bps / 10000.0)::int, new.commission_cents);
    if v_amount > 0 then
      insert into public.creator_commissions (attribution_id, creator_id, rate_bps, amount_cents, status)
      values (a.id, a.creator_id, c.affiliate_commission_bps, v_amount, 'pending')
      on conflict (attribution_id) do nothing;
      insert into public.notifications (user_id, type, title, body, data)
      values (a.creator_id, 'creator_commission', 'You earned a commission',
              'An order from your video was collected. Earnings are confirmed after the refund window.',
              jsonb_build_object('order_id', new.id, 'amount_cents', v_amount));
    end if;
  end if;
  return null;
end $$;
create trigger orders_creator_commission after update on public.orders
  for each row execute function public.create_creator_commission();

-- Void unpaid commissions when the order is refunded.
create or replace function public.void_commission_on_refund() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' then
    update public.creator_commissions cc set status = 'void', void_reason = 'Order refunded'
    from public.creator_attributions a
    where a.id = cc.attribution_id and a.order_id = new.order_id and cc.status in ('pending', 'approved');
  end if;
  return null;
end $$;
create trigger refunds_void_commission after update on public.refunds
  for each row execute function public.void_commission_on_refund();

create or replace function public.approve_due_creator_commissions(p_days integer default 7) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  -- Disputed orders are voided rather than approved.
  update public.creator_commissions cc set status = 'void', void_reason = 'Payment disputed'
  from public.creator_attributions a, public.payments p, public.payment_disputes d
  where a.id = cc.attribution_id and p.order_id = a.order_id and d.payment_id = p.id and cc.status in ('pending', 'approved');

  update public.creator_commissions cc set status = 'approved', approved_at = now()
  from public.creator_attributions a, public.orders o
  where cc.status = 'pending' and a.id = cc.attribution_id and o.id = a.order_id
    and o.status = 'completed' and o.completed_at < now() - make_interval(days => p_days)
    and not exists (select 1 from public.refunds r where r.order_id = o.id and r.status <> 'rejected');
  get diagnostics n = row_count;
  return n;
end $$;

-- Approved commissions ready to transfer, grouped per creator with a connected account.
create or replace function public.creator_payouts_due(p_min_cents integer default 1000)
returns table (creator_id uuid, stripe_account_id text, amount_cents bigint, commission_ids uuid[])
language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  return query
  select c.user_id, c.stripe_account_id, sum(cc.amount_cents)::bigint, array_agg(cc.id order by cc.id)
  from public.creator_commissions cc join public.creators c on c.user_id = cc.creator_id
  where cc.status = 'approved' and c.payouts_enabled and c.stripe_account_id is not null
  group by c.user_id, c.stripe_account_id
  having sum(cc.amount_cents) >= p_min_cents;
end $$;

create or replace function public.mark_commissions_paid(p_commission_ids uuid[], p_transfer_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  update public.creator_commissions set status = 'paid', paid_at = now(), provider_transfer_id = p_transfer_id
   where id = any (p_commission_ids) and status = 'approved';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.set_creator_stripe_status(p_account_id text, p_payouts_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  update public.creators set payouts_enabled = p_payouts_enabled where stripe_account_id = p_account_id;
end $$;

-- ===================================================================================
-- Collaborative recommendations: "people who craved this also craved…"
-- Item-item similarity from positive signals of consenting users only (cosine on co-occurrence).
-- Aggregate, non-personal output: no user ids are stored.
-- ===================================================================================
create table public.video_similarity (
  video_id         uuid not null references public.videos(id) on delete cascade,
  similar_video_id uuid not null references public.videos(id) on delete cascade,
  score            real not null check (score > 0 and score <= 1),
  support          integer not null,
  computed_at      timestamptz not null default now(),
  primary key (video_id, similar_video_id),
  check (video_id <> similar_video_id)
);
create index video_similarity_similar_idx on public.video_similarity (similar_video_id);
alter table public.video_similarity enable row level security;
create policy admin_all on public.video_similarity for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant all on public.video_similarity to service_role;
grant select on public.video_similarity to authenticated;

create or replace function public.refresh_video_similarity(p_days integer default 90, p_min_support integer default 3, p_top_k integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.request_is_privileged() or public.is_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  drop table if exists _pos; drop table if exists _cnt;
  create temporary table _pos on commit drop as
    select distinct x.user_id, x.video_id from (
      select s.user_id, s.video_id, s.created_at from public.swipe_events s where s.direction = 'right'
      union all select l.user_id, l.video_id, l.created_at from public.video_likes l
      union all select o.user_id, oi.source_video_id, o.created_at from public.orders o join public.order_items oi on oi.order_id = o.id
        where o.status in ('placed', 'accepted', 'preparing', 'ready', 'completed') and oi.source_video_id is not null
    ) x
    join public.profiles p on p.id = x.user_id
    where x.created_at >= now() - make_interval(days => p_days)
      and x.created_at > coalesce(p.taste_reset_at, '-infinity')
      and public.has_consent(x.user_id, 'personalisation')
      -- Remove signals the user later reversed with a left swipe.
      and not exists (select 1 from public.swipe_events l where l.user_id = x.user_id and l.video_id = x.video_id
                        and l.direction = 'left' and l.created_at > x.created_at);
  create temporary table _cnt on commit drop as select video_id, count(*)::numeric as n from _pos group by video_id;

  delete from public.video_similarity;
  insert into public.video_similarity (video_id, similar_video_id, score, support)
  select video_id, similar_video_id, score, support from (
    select a.video_id, b.video_id as similar_video_id, count(*)::int as support,
           least(1, count(*) / sqrt(ca.n * cb.n))::real as score,
           row_number() over (partition by a.video_id order by count(*) / sqrt(ca.n * cb.n) desc) as rk
    from _pos a join _pos b on a.user_id = b.user_id and a.video_id <> b.video_id
    join _cnt ca on ca.video_id = a.video_id join _cnt cb on cb.video_id = b.video_id
    join public.videos v on v.id = b.video_id and v.status = 'published'
    group by a.video_id, b.video_id, ca.n, cb.n
    having count(*) >= p_min_support
  ) s where rk <= p_top_k;
  get diagnostics n = row_count;
  return n;
end $$;

-- ===================================================================================
-- Delivery (provider-agnostic). Disabled until a delivery partner is contracted and configured.
-- ===================================================================================
alter table public.restaurant_locations add column delivery_min_order_cents integer not null default 2000 check (delivery_min_order_cents >= 0);

create table public.deliveries (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null unique references public.orders(id) on delete cascade,
  provider           text not null,
  external_id        text,
  quote_id           text,
  status             text not null default 'quoted' check (status in ('quoted', 'requested', 'courier_assigned', 'picked_up', 'delivered', 'cancelled', 'failed')),
  fee_cents          integer not null check (fee_cents >= 0),
  -- Delivery address (personal information: visible to the customer, admins and — for fulfilment only — the restaurant).
  address_line1      text not null,
  address_line2      text,
  suburb             text not null,
  region             text not null,
  postcode           text not null check (postcode ~ '^[0-9]{4}$'),
  lat                double precision not null,
  lng                double precision not null,
  dropoff_instructions text check (char_length(dropoff_instructions) <= 200),
  contact_phone      text not null,
  tracking_url       text,          -- provided by the delivery partner only
  courier_name       text,          -- provided by the delivery partner only
  estimated_dropoff_at timestamptz,
  last_event_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index deliveries_external_idx on public.deliveries (provider, external_id) where external_id is not null;
create trigger deliveries_updated_at before update on public.deliveries for each row execute function public.set_updated_at();
alter table public.deliveries enable row level security;
create policy admin_all on public.deliveries for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy deliveries_read on public.deliveries for select to authenticated using (public.can_view_order(order_id));
grant select on public.deliveries to authenticated;
grant all on public.deliveries to service_role;

-- Status updates come only from the delivery partner (via the API webhook). Statuses only move forward.
create or replace function public.apply_delivery_update(p_provider text, p_external_id text, p_status text,
  p_tracking_url text, p_courier_name text, p_eta timestamptz, p_event_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare d public.deliveries; v_rank_old int; v_rank_new int; v_user uuid;
  ranks constant text[] := array['quoted', 'requested', 'courier_assigned', 'picked_up', 'delivered'];
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  select * into d from public.deliveries where provider = p_provider and external_id = p_external_id for update;
  if not found then raise exception 'Unknown delivery' using errcode = 'P0002'; end if;
  if d.last_event_at is not null and p_event_at < d.last_event_at then return; end if; -- out-of-order event
  if d.status in ('delivered', 'cancelled', 'failed') then return; end if;
  v_rank_old := coalesce(array_position(ranks, d.status), 0);
  v_rank_new := coalesce(array_position(ranks, p_status), 99);
  if p_status not in ('cancelled', 'failed') and v_rank_new < v_rank_old then return; end if;
  update public.deliveries set status = p_status, tracking_url = coalesce(p_tracking_url, tracking_url),
         courier_name = coalesce(p_courier_name, courier_name), estimated_dropoff_at = coalesce(p_eta, estimated_dropoff_at),
         last_event_at = p_event_at where id = d.id;
  if p_status = 'delivered' then
    update public.orders set status = 'completed' where id = d.order_id and status = 'ready';
  end if;
  select user_id into v_user from public.orders where id = d.order_id;
  if v_user is not null and p_status in ('courier_assigned', 'picked_up', 'delivered', 'failed') then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_user, 'delivery', case p_status when 'courier_assigned' then 'Courier assigned' when 'picked_up' then 'Your order is on its way'
                                              when 'delivered' then 'Delivered' else 'Delivery problem — we''re on it' end,
            null, jsonb_build_object('order_id', d.order_id, 'status', p_status));
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['approve_due_creator_commissions(integer)', 'creator_payouts_due(integer)', 'mark_commissions_paid(uuid[], text)',
                           'set_creator_stripe_status(text, boolean)', 'apply_delivery_update(text, text, text, text, text, timestamptz, timestamptz)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke execute on function public.refresh_video_similarity(integer, integer, integer) from public, anon';
end $$;

-- Orders can now be created for delivery: replace create_pending_order with a fulfilment-aware version.
drop function public.create_pending_order(uuid, uuid, uuid, text, text, timestamptz, uuid, jsonb, uuid);
create or replace function public.create_pending_order(
  p_user_id uuid, p_restaurant_id uuid, p_location_id uuid, p_pickup_name text, p_note text,
  p_scheduled_for timestamptz, p_source_video_id uuid, p_quote jsonb, p_idempotency_key uuid,
  p_fulfilment public.fulfilment_type default 'pickup'
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_line jsonb;
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  select * into v_order from public.orders where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then return v_order; end if;
  if not exists (select 1 from public.restaurant_locations l join public.restaurants r on r.id = l.restaurant_id
                 where l.id = p_location_id and r.id = p_restaurant_id and r.status = 'verified'
                   and (p_fulfilment = 'pickup' or l.delivery_enabled)) then
    raise exception 'Restaurant is not available' using errcode = 'P0001';
  end if;
  if p_fulfilment = 'pickup' and coalesce((p_quote ->> 'deliveryFeeCents')::int, 0) <> 0 then
    raise exception 'Pickup orders cannot carry a delivery fee' using errcode = 'P0001';
  end if;

  insert into public.orders (
    user_id, restaurant_id, location_id, status, fulfilment, scheduled_for, pickup_name, customer_note, currency,
    subtotal_cents, service_fee_cents, delivery_fee_cents, discount_cents, total_cents, gst_cents,
    commission_rate_bps, commission_cents, restaurant_net_cents, source_video_id, pricing_version, idempotency_key
  ) values (
    p_user_id, p_restaurant_id, p_location_id, 'pending_payment', p_fulfilment, p_scheduled_for, left(p_pickup_name, 40), left(p_note, 300),
    coalesce(p_quote ->> 'currency', 'AUD'),
    (p_quote ->> 'subtotalCents')::int, (p_quote ->> 'serviceFeeCents')::int, coalesce((p_quote ->> 'deliveryFeeCents')::int, 0),
    (p_quote ->> 'discountCents')::int, (p_quote ->> 'totalCents')::int, (p_quote ->> 'gstCents')::int,
    (p_quote ->> 'commissionRateBps')::int, (p_quote ->> 'commissionCents')::int, (p_quote ->> 'restaurantNetCents')::int,
    p_source_video_id, p_quote ->> 'pricingVersion', p_idempotency_key
  ) returning * into v_order;

  for v_line in select * from jsonb_array_elements(p_quote -> 'lines') loop
    if not exists (select 1 from public.menu_items where id = (v_line ->> 'menuItemId')::uuid and restaurant_id = p_restaurant_id) then
      raise exception 'Basket contains an item from another restaurant' using errcode = 'P0001';
    end if;
    insert into public.order_items (order_id, menu_item_id, name, unit_price_cents, quantity, options, notes, line_total_cents, source_video_id)
    values (v_order.id, (v_line ->> 'menuItemId')::uuid, v_line ->> 'name', (v_line ->> 'unitPriceCents')::int,
            (v_line ->> 'quantity')::int, coalesce(v_line -> 'options', '[]'::jsonb), v_line ->> 'notes',
            (v_line ->> 'lineTotalCents')::int, nullif(v_line ->> 'sourceVideoId', '')::uuid);
  end loop;
  if (select coalesce(sum(line_total_cents), -1) from public.order_items where order_id = v_order.id) <> v_order.subtotal_cents then
    raise exception 'Order lines do not reconcile with subtotal' using errcode = 'P0001';
  end if;
  return v_order;
end $$;
revoke execute on function public.create_pending_order(uuid, uuid, uuid, text, text, timestamptz, uuid, jsonb, uuid, public.fulfilment_type) from public, anon, authenticated;
grant execute on function public.create_pending_order(uuid, uuid, uuid, text, text, timestamptz, uuid, jsonb, uuid, public.fulfilment_type) to service_role;

-- Deliveries waiting to be dispatched to the partner once the restaurant has accepted the order.
create or replace function public.deliveries_to_dispatch(p_limit integer default 20)
returns table (delivery_id uuid, order_id uuid, order_number text, quote_id text, provider text, restaurant_name text,
               pickup_address text, pickup_lat double precision, pickup_lng double precision, pickup_phone text, prep_minutes smallint,
               dropoff jsonb, total_cents integer)
language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  return query
  select d.id, o.id, o.order_number, d.quote_id, d.provider, r.name,
         l.address_line1 || ', ' || l.suburb || ' ' || l.region || ' ' || l.postcode, l.lat, l.lng, l.phone, l.prep_time_minutes,
         jsonb_build_object('line1', d.address_line1, 'line2', d.address_line2, 'suburb', d.suburb, 'region', d.region, 'postcode', d.postcode,
                            'lat', d.lat, 'lng', d.lng, 'phone', d.contact_phone, 'instructions', d.dropoff_instructions, 'name', o.pickup_name),
         o.total_cents
  from public.deliveries d join public.orders o on o.id = d.order_id
  join public.restaurants r on r.id = o.restaurant_id join public.restaurant_locations l on l.id = o.location_id
  where d.status = 'quoted' and o.status in ('accepted', 'preparing', 'ready')
  order by o.accepted_at limit p_limit;
end $$;
revoke execute on function public.deliveries_to_dispatch(integer) from public, anon, authenticated;
grant execute on function public.deliveries_to_dispatch(integer) to service_role;
