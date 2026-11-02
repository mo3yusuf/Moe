-- Ordering: atomic order creation, payment confirmation, attribution, cancellation and refund requests.

alter table public.orders add column idempotency_key uuid;
create unique index orders_idempotency_idx on public.orders (user_id, idempotency_key) where idempotency_key is not null;

alter table public.payments add constraint payments_provider_check check (provider in ('stripe', 'simulated'));
-- Simulated payments can never be marked live.
alter table public.payments add constraint payments_simulated_is_test check (provider <> 'simulated' or is_test_mode);

-- Creates an order in pending_payment from a server-computed quote (JSON produced by @crave/core
-- quoteBasket). Backend only. Idempotent per (user, key): retries return the original order.
create or replace function public.create_pending_order(
  p_user_id uuid, p_restaurant_id uuid, p_location_id uuid, p_pickup_name text, p_note text,
  p_scheduled_for timestamptz, p_source_video_id uuid, p_quote jsonb, p_idempotency_key uuid
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
                 where l.id = p_location_id and r.id = p_restaurant_id and r.status = 'verified') then
    raise exception 'Restaurant is not available' using errcode = 'P0001';
  end if;

  insert into public.orders (
    user_id, restaurant_id, location_id, status, fulfilment, scheduled_for, pickup_name, customer_note, currency,
    subtotal_cents, service_fee_cents, delivery_fee_cents, discount_cents, total_cents, gst_cents,
    commission_rate_bps, commission_cents, restaurant_net_cents, source_video_id, pricing_version, idempotency_key
  ) values (
    p_user_id, p_restaurant_id, p_location_id, 'pending_payment', 'pickup', p_scheduled_for, left(p_pickup_name, 40), left(p_note, 300),
    coalesce(p_quote ->> 'currency', 'AUD'),
    (p_quote ->> 'subtotalCents')::int, (p_quote ->> 'serviceFeeCents')::int, (p_quote ->> 'deliveryFeeCents')::int,
    (p_quote ->> 'discountCents')::int, (p_quote ->> 'totalCents')::int, (p_quote ->> 'gstCents')::int,
    (p_quote ->> 'commissionRateBps')::int, (p_quote ->> 'commissionCents')::int, (p_quote ->> 'restaurantNetCents')::int,
    p_source_video_id, p_quote ->> 'pricingVersion', p_idempotency_key
  ) returning * into v_order;

  for v_line in select * from jsonb_array_elements(p_quote -> 'lines') loop
    -- Every line must belong to this restaurant (defence in depth; the API already checks).
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

-- Records a successful payment and releases the order to the restaurant. Used by the Stripe
-- webhook (Phase 7) and, in development only, by the simulated payment step. Backend only.
create or replace function public.confirm_order_payment(
  p_order_id uuid, p_provider text, p_provider_ref text, p_amount_cents integer,
  p_application_fee_cents integer, p_test_mode boolean
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_creator uuid;
  v_attributed integer;
  v_member record;
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_order.status = 'placed' and exists (select 1 from public.payments where order_id = p_order_id and provider_payment_intent_id = p_provider_ref) then
    return v_order; -- duplicate webhook delivery
  end if;
  if v_order.status <> 'pending_payment' then
    raise exception 'Order is not awaiting payment (status %)', v_order.status using errcode = 'P0001';
  end if;
  if p_amount_cents <> v_order.total_cents then
    raise exception 'Payment amount % does not match order total %', p_amount_cents, v_order.total_cents using errcode = 'P0001';
  end if;

  insert into public.payments (order_id, provider, provider_payment_intent_id, amount_cents, application_fee_cents, currency, status, is_test_mode)
  values (p_order_id, p_provider, p_provider_ref, p_amount_cents, p_application_fee_cents, v_order.currency, 'succeeded', p_test_mode);

  update public.orders set status = 'placed' where id = p_order_id returning * into v_order;

  -- Creator attribution: the order was started from a creator's video that has an approved link
  -- to at least one ordered item. Attributed revenue = lines ordered from that video.
  if v_order.source_video_id is not null then
    select v.uploader_id into v_creator from public.videos v
      join public.creators c on c.user_id = v.uploader_id
      where v.id = v_order.source_video_id and v.source <> 'restaurant';
    select coalesce(sum(oi.line_total_cents), 0) into v_attributed from public.order_items oi
      where oi.order_id = p_order_id and oi.source_video_id = v_order.source_video_id
        and exists (select 1 from public.video_menu_items vmi where vmi.video_id = v_order.source_video_id
                      and vmi.menu_item_id = oi.menu_item_id and vmi.status = 'approved');
    if v_attributed > 0 then
      insert into public.creator_attributions (order_id, video_id, creator_id, attributed_revenue_cents)
      values (p_order_id, v_order.source_video_id, v_creator, v_attributed) on conflict (order_id) do nothing;
      update public.video_stats set orders = orders + 1, revenue_cents = revenue_cents + v_attributed, updated_at = now()
        where video_id = v_order.source_video_id;
    end if;
  end if;

  update public.baskets set status = 'converted' where user_id = v_order.user_id and status = 'active' and restaurant_id = v_order.restaurant_id;

  for v_member in select user_id from public.restaurant_members where restaurant_id = v_order.restaurant_id loop
    insert into public.notifications (user_id, type, title, body, data)
    values (v_member.user_id, 'new_order', 'New order ' || v_order.order_number,
            'Pickup for ' || v_order.pickup_name, jsonb_build_object('order_id', v_order.id));
  end loop;
  return v_order;
end $$;

-- When a paid order is rejected or cancelled, a full refund request is created automatically.
-- Execution against the payment provider happens in the backend (Phase 7).
create or replace function public.request_refund_on_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_payment public.payments;
begin
  if new.status in ('rejected', 'cancelled') and old.status is distinct from new.status then
    select * into v_payment from public.payments where order_id = new.id and status = 'succeeded' order by created_at desc limit 1;
    if found and not exists (select 1 from public.refunds where order_id = new.id) then
      insert into public.refunds (order_id, payment_id, amount_cents, reason, details, status, initiated_by)
      values (new.id, v_payment.id, v_payment.amount_cents,
              case when new.status = 'rejected' then 'restaurant_rejected'
                   when auth.uid() = new.user_id then 'customer_request' else 'restaurant_cancelled' end,
              new.cancel_reason, 'requested', auth.uid());
      if new.user_id is not null then
        insert into public.notifications (user_id, type, title, body, data)
        values (new.user_id, 'refund', 'Refund on its way', 'A full refund for order ' || new.order_number || ' has been requested.',
                jsonb_build_object('order_id', new.id));
      end if;
    end if;
  end if;
  return null;
end $$;
create trigger orders_refund_on_cancel after update on public.orders
  for each row execute function public.request_refund_on_cancel();

-- Customers may cancel until the restaurant accepts.
create or replace function public.customer_cancel_order(p_order_id uuid, p_reason text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.user_id is distinct from auth.uid() then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_order.status not in ('pending_payment', 'placed') then
    raise exception 'This order has already been accepted by the restaurant. Please contact them directly.' using errcode = 'P0001';
  end if;
  update public.orders set status = 'cancelled', cancel_reason = coalesce(left(p_reason, 200), 'Cancelled by customer')
   where id = p_order_id returning * into v_order;
  return v_order;
end $$;

revoke execute on function public.create_pending_order(uuid, uuid, uuid, text, text, timestamptz, uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.confirm_order_payment(uuid, text, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.create_pending_order(uuid, uuid, uuid, text, text, timestamptz, uuid, jsonb, uuid) to service_role;
grant execute on function public.confirm_order_payment(uuid, text, text, integer, integer, boolean) to service_role;
grant execute on function public.customer_cancel_order(uuid, text) to authenticated;
