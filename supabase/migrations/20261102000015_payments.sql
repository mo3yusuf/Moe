-- Stripe Connect payments: payment intents, failures, expiry, refund execution, disputes, payouts,
-- connected-account status, account deletion processing and user blocking.
-- All functions here are backend-only (service role) unless stated otherwise.

-- Payment intent created at checkout (status requires_payment until the webhook confirms it).
create or replace function public.record_payment_intent(p_order_id uuid, p_intent_id text, p_amount_cents integer, p_application_fee_cents integer, p_test_mode boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  insert into public.payments (order_id, provider, provider_payment_intent_id, amount_cents, application_fee_cents, status, is_test_mode)
  values (p_order_id, 'stripe', p_intent_id, p_amount_cents, p_application_fee_cents, 'requires_payment', p_test_mode)
  on conflict (provider_payment_intent_id) do nothing;
end $$;

-- Replaces the Phase 5 version: updates an existing intent row instead of inserting a duplicate.
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
  if exists (select 1 from public.payments where order_id = p_order_id and provider_payment_intent_id = p_provider_ref and status = 'succeeded') then
    return v_order; -- duplicate webhook delivery
  end if;
  if v_order.status not in ('pending_payment', 'payment_failed') then
    raise exception 'Order is not awaiting payment (status %)', v_order.status using errcode = 'P0001';
  end if;
  if p_amount_cents <> v_order.total_cents then
    raise exception 'Payment amount % does not match order total %', p_amount_cents, v_order.total_cents using errcode = 'P0001';
  end if;

  update public.payments set status = 'succeeded', amount_cents = p_amount_cents, application_fee_cents = p_application_fee_cents, failure_reason = null
   where provider_payment_intent_id = p_provider_ref and order_id = p_order_id;
  if not found then
    insert into public.payments (order_id, provider, provider_payment_intent_id, amount_cents, application_fee_cents, currency, status, is_test_mode)
    values (p_order_id, p_provider, p_provider_ref, p_amount_cents, p_application_fee_cents, v_order.currency, 'succeeded', p_test_mode);
  end if;

  if v_order.status = 'payment_failed' then update public.orders set status = 'pending_payment' where id = p_order_id; end if;
  update public.orders set status = 'placed' where id = p_order_id returning * into v_order;

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
    values (v_member.user_id, 'new_order', 'New order ' || v_order.order_number, 'Pickup for ' || v_order.pickup_name, jsonb_build_object('order_id', v_order.id));
  end loop;
  return v_order;
end $$;

-- A payment attempt failed (card declined etc.). The intent stays usable for a retry, so the order
-- stays in pending_payment; the failure is recorded for the customer and for fraud rules.
create or replace function public.mark_payment_failed(p_intent_id text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  update public.payments set status = 'failed', failure_reason = left(p_reason, 300)
   where provider_payment_intent_id = p_intent_id and status <> 'succeeded';
end $$;

-- Orders left unpaid are cancelled so they never reach a restaurant. Returns the intents to cancel at Stripe.
create or replace function public.expire_unpaid_orders(p_minutes integer default 30)
returns table (order_id uuid, intent_id text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  return query
  with expired as (
    update public.orders o set status = 'cancelled', cancel_reason = 'Payment not completed'
    where o.status = 'pending_payment' and o.created_at < now() - make_interval(mins => p_minutes)
    returning o.id
  )
  select e.id, p.provider_payment_intent_id from expired e
  left join public.payments p on p.order_id = e.id and p.provider = 'stripe' and p.status <> 'succeeded';
end $$;

alter table public.refunds add column processing_started_at timestamptz;

-- Refund execution queue. Refunds created automatically for customer cancellation or restaurant
-- rejection are auto-approved; anything else must have been approved by an admin ('pending').
create or replace function public.claim_refunds_for_processing(p_limit integer default 20)
returns table (refund_id uuid, order_id uuid, amount_cents integer, provider text, intent_id text, is_test_mode boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  return query
  with c as (
    select r.id from public.refunds r
    where r.provider_refund_id is null
      -- Lease: a claimed refund is not handed out again unless the worker crashed (15 min).
      and (r.processing_started_at is null or r.processing_started_at < now() - interval '15 minutes')
      and (r.status = 'pending' or (r.status = 'requested' and r.reason in ('customer_request', 'restaurant_rejected', 'restaurant_cancelled')
                                     and exists (select 1 from public.orders o where o.id = r.order_id and o.status in ('cancelled', 'rejected'))))
    order by r.created_at
    limit p_limit
    for update skip locked
  ), u as (
    update public.refunds r set status = 'pending', processing_started_at = now(), updated_at = now() from c where r.id = c.id returning r.*
  )
  select u.id, u.order_id, u.amount_cents, p.provider, p.provider_payment_intent_id, p.is_test_mode
  from u join public.payments p on p.id = u.payment_id;
end $$;

create or replace function public.mark_refund_result(p_refund_id uuid, p_provider_refund_id text, p_status public.refund_status, p_failure text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.refunds; v_total integer; v_paid integer; v_user uuid; v_number text;
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  update public.refunds set status = p_status,
         processing_started_at = case when p_status = 'failed' then null else processing_started_at end,
         provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
         details = case when p_failure is not null then coalesce(details || ' | ', '') || 'Failed: ' || p_failure else details end
   where id = p_refund_id or (p_provider_refund_id is not null and provider_refund_id = p_provider_refund_id)
   returning * into r;
  if not found then return; end if;
  if p_status = 'succeeded' then
    select coalesce(sum(amount_cents), 0) into v_total from public.refunds where payment_id = r.payment_id and status = 'succeeded';
    select amount_cents into v_paid from public.payments where id = r.payment_id;
    update public.payments set status = case when v_total >= v_paid then 'refunded' else 'partially_refunded' end::public.payment_status where id = r.payment_id;
    select user_id, order_number into v_user, v_number from public.orders where id = r.order_id;
    if v_user is not null then
      insert into public.notifications (user_id, type, title, body, data)
      values (v_user, 'refund', 'Refund processed', 'Your refund for order ' || v_number || ' has been sent. Banks usually take 5–10 business days.',
              jsonb_build_object('order_id', r.order_id, 'amount_cents', r.amount_cents));
    end if;
  end if;
end $$;

create or replace function public.record_dispute(p_intent_id text, p_dispute_id text, p_amount_cents integer, p_reason text, p_status text, p_evidence_due timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_payment public.payments; v_new boolean; v_admin record; v_order public.orders;
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  select * into v_payment from public.payments where provider_payment_intent_id = p_intent_id;
  if not found then raise exception 'Unknown payment %', p_intent_id using errcode = 'P0002'; end if;
  v_new := not exists (select 1 from public.payment_disputes where provider_dispute_id = p_dispute_id);
  insert into public.payment_disputes (payment_id, provider_dispute_id, amount_cents, reason, status, evidence_due_by)
  values (v_payment.id, p_dispute_id, p_amount_cents, p_reason, p_status, p_evidence_due)
  on conflict (provider_dispute_id) do update set status = excluded.status, amount_cents = excluded.amount_cents,
     evidence_due_by = excluded.evidence_due_by, updated_at = now();
  if v_new then
    select * into v_order from public.orders where id = v_payment.order_id;
    insert into public.fraud_flags (entity_type, entity_id, rule, severity, details)
    values ('order', v_order.id, 'payment_dispute', 'high', jsonb_build_object('dispute', p_dispute_id, 'reason', p_reason, 'amount_cents', p_amount_cents, 'evidence_due_by', p_evidence_due));
    for v_admin in select user_id from public.user_roles where role = 'admin' loop
      insert into public.notifications (user_id, type, title, body, data)
      values (v_admin.user_id, 'dispute', 'Chargeback on ' || v_order.order_number, 'Evidence due ' || coalesce(to_char(p_evidence_due at time zone 'Australia/Brisbane', 'DD Mon YYYY'), 'soon'),
              jsonb_build_object('order_id', v_order.id, 'dispute', p_dispute_id));
    end loop;
  end if;
end $$;

create or replace function public.set_restaurant_stripe_status(p_account_id text, p_charges_enabled boolean, p_payouts_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  -- payouts_enabled here means "can take card orders": Stripe must allow both charges and payouts.
  update public.restaurants set payouts_enabled = (p_charges_enabled and p_payouts_enabled) where stripe_account_id = p_account_id;
end $$;

create or replace function public.upsert_restaurant_payout(p_account_id text, p_payout_id text, p_amount_cents integer, p_currency text, p_status text, p_arrival date)
returns void language plpgsql security definer set search_path = public as $$
declare v_rid uuid;
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  select id into v_rid from public.restaurants where stripe_account_id = p_account_id;
  if v_rid is null then return; end if;
  insert into public.restaurant_payouts (restaurant_id, provider_payout_id, amount_cents, currency, status, arrival_date)
  values (v_rid, p_payout_id, p_amount_cents, upper(p_currency), p_status, p_arrival)
  on conflict (provider_payout_id) do update set status = excluded.status, amount_cents = excluded.amount_cents, arrival_date = excluded.arrival_date;
end $$;

-- Account deletion processing (APP 11.2 / Apple 5.1.1(v)). Deferred while the user has an active order.
create or replace function public.deletion_requests_ready(p_limit integer default 20)
returns table (request_id uuid, user_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  return query
  select d.id, d.user_id from public.data_deletion_requests d
  where d.request_type = 'account_deletion' and d.status in ('received', 'processing') and d.user_id is not null
    and not exists (select 1 from public.orders o where o.user_id = d.user_id and o.status in ('pending_payment', 'placed', 'accepted', 'preparing', 'ready'))
  order by d.requested_at limit p_limit;
end $$;

-- Users can block accounts whose videos they don't want to see (App Store guideline 1.2 for UGC apps).
create table public.user_blocks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
create policy admin_all on public.user_blocks for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy blocks_own on public.user_blocks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.user_blocks to authenticated;
grant all on public.user_blocks to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'record_payment_intent(uuid, text, integer, integer, boolean)', 'confirm_order_payment(uuid, text, text, integer, integer, boolean)',
    'mark_payment_failed(text, text)', 'expire_unpaid_orders(integer)', 'claim_refunds_for_processing(integer)',
    'mark_refund_result(uuid, text, public.refund_status, text)', 'record_dispute(text, text, integer, text, text, timestamptz)',
    'set_restaurant_stripe_status(text, boolean, boolean)', 'upsert_restaurant_payout(text, text, integer, text, text, date)',
    'deletion_requests_ready(integer)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
