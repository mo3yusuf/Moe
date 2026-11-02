-- Reporting for restaurants and administrators, plus audited admin operations.
-- "Sales" = orders the restaurant received (placed or later), excluding rejected/cancelled.

create or replace function public.restaurant_sales_report(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.can_manage_restaurant(p_restaurant_id) or public.is_admin()) then
    raise exception 'Only owners and managers can view sales' using errcode = '42501';
  end if;
  with o as (
    select * from public.orders
    where restaurant_id = p_restaurant_id and created_at >= p_from and created_at < p_to
      and status not in ('pending_payment', 'payment_failed')
  ), good as (select * from o where status not in ('rejected', 'cancelled'))
  select jsonb_build_object(
    'orders', (select count(*) from good),
    'grossSalesCents', (select coalesce(sum(subtotal_cents), 0) from good),
    'commissionCents', (select coalesce(sum(commission_cents), 0) from good),
    'netCents', (select coalesce(sum(restaurant_net_cents), 0) from good),
    'averageOrderCents', (select coalesce(round(avg(subtotal_cents)), 0) from good),
    'rejected', (select count(*) from o where status = 'rejected'),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'refundedCents', (select coalesce(sum(r.amount_cents), 0) from public.refunds r join o on o.id = r.order_id where r.status = 'succeeded'),
    'fromVideosCents', (select coalesce(sum(subtotal_cents), 0) from good where source_video_id is not null),
    'fromCreatorsCents', (select coalesce(sum(a.attributed_revenue_cents), 0) from public.creator_attributions a join good on good.id = a.order_id),
    'daily', (select coalesce(jsonb_agg(d order by d->>'date'), '[]') from (
        select jsonb_build_object('date', to_char(created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
                                  'orders', count(*), 'salesCents', sum(subtotal_cents), 'netCents', sum(restaurant_net_cents)) d
        from good group by to_char(created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD')) x),
    'topItems', (select coalesce(jsonb_agg(t order by (t->>'salesCents')::int desc), '[]') from (
        select jsonb_build_object('name', oi.name, 'quantity', sum(oi.quantity), 'salesCents', sum(oi.line_total_cents)) t
        from public.order_items oi join good on good.id = oi.order_id group by oi.name order by sum(oi.line_total_cents) desc limit 10) y),
    'videos', (select coalesce(jsonb_agg(vv order by (vv->>'salesCents')::int desc), '[]') from (
        select jsonb_build_object('videoId', v.id, 'caption', v.caption, 'source', v.source,
                 'creatorHandle', c.handle, 'orders', count(distinct good.id), 'salesCents', sum(good.subtotal_cents),
                 'attributedCents', coalesce(sum(a.attributed_revenue_cents), 0),
                 'impressions', max(s.impressions), 'rightSwipes', max(s.right_swipes)) vv
        from good join public.videos v on v.id = good.source_video_id
        left join public.creators c on c.user_id = v.uploader_id and v.source <> 'restaurant'
        left join public.creator_attributions a on a.order_id = good.id
        left join public.video_stats s on s.video_id = v.id
        group by v.id, v.caption, v.source, c.handle limit 50) z)
  ) into v;
  return v;
end $$;

create or replace function public.admin_platform_metrics(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  with good as (
    select * from public.orders where created_at >= p_from and created_at < p_to
      and status in ('placed', 'accepted', 'preparing', 'ready', 'completed')
  )
  select jsonb_build_object(
    'orders', (select count(*) from good),
    'gmvCents', (select coalesce(sum(total_cents), 0) from good),
    'commissionCents', (select coalesce(sum(commission_cents), 0) from good),
    'serviceFeeCents', (select coalesce(sum(service_fee_cents), 0) from good),
    'refundsRequestedCents', (select coalesce(sum(amount_cents), 0) from public.refunds where created_at >= p_from and created_at < p_to),
    'refundsOpen', (select count(*) from public.refunds where status in ('requested', 'pending')),
    'testModeOrders', (select count(*) from good where exists (select 1 from public.payments p where p.order_id = good.id and p.is_test_mode)),
    'newUsers', (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    'activeRestaurants', (select count(*) from public.restaurants where status = 'verified'),
    'pendingVerifications', (select count(*) from public.restaurant_verifications where status in ('submitted', 'in_review')),
    'videosPendingReview', (select count(*) from public.videos where status = 'pending_review'),
    'openReports', (select count(*) from public.content_reports where status in ('open', 'in_review')),
    'openAppeals', (select count(*) from public.moderation_appeals where status = 'open'),
    'openFraudFlags', (select count(*) from public.fraud_flags where status in ('open', 'investigating')),
    'ordersFromVideosPct', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where source_video_id is not null) / count(*)) end from good)
  ) into v;
  return v;
end $$;

-- Recommendation quality per model version, split by exploration vs. exploitation slots.
create or replace function public.recommendation_performance(p_days integer default 14)
returns table (model_version text, is_exploration boolean, impressions bigint, users bigint,
               right_swipe_rate numeric, left_swipe_rate numeric, completion_rate numeric, order_rate numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  return query
  with imp as (
    select ri.* from public.recommendation_impressions ri where ri.created_at >= now() - make_interval(days => p_days)
  )
  select imp.model_version, imp.is_exploration, count(*)::bigint, count(distinct imp.user_id)::bigint,
    round(avg((exists (select 1 from public.swipe_events s where s.user_id = imp.user_id and s.video_id = imp.video_id and s.direction = 'right'
            and s.created_at between imp.created_at and imp.created_at + interval '1 day'))::int), 4),
    round(avg((exists (select 1 from public.swipe_events s where s.user_id = imp.user_id and s.video_id = imp.video_id and s.direction = 'left'
            and s.created_at between imp.created_at and imp.created_at + interval '1 day'))::int), 4),
    round(avg((exists (select 1 from public.video_interactions i where i.user_id = imp.user_id and i.video_id = imp.video_id
            and i.event_type = 'watch' and i.completion_pct >= 95 and i.created_at between imp.created_at and imp.created_at + interval '1 day'))::int), 4),
    round(avg((exists (select 1 from public.orders o where o.user_id = imp.user_id and o.source_video_id = imp.video_id
            and o.status in ('placed','accepted','preparing','ready','completed') and o.created_at between imp.created_at and imp.created_at + interval '1 day'))::int), 4)
  from imp group by imp.model_version, imp.is_exploration
  order by imp.model_version, imp.is_exploration;
end $$;

-- Rule-based fraud signals. Creates flags for admin review; never takes automatic action.
create or replace function public.run_fraud_rules() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer;
begin
  if not (public.is_admin() or public.request_is_privileged()) then raise exception 'Admin only' using errcode = '42501'; end if;

  -- Customer: 3+ refunds in 30 days.
  insert into public.fraud_flags (entity_type, entity_id, rule, severity, details)
  select 'user', o.user_id, 'refunds_30d', 'medium', jsonb_build_object('refunds', count(*), 'amount_cents', sum(r.amount_cents))
  from public.refunds r join public.orders o on o.id = r.order_id
  where r.created_at >= now() - interval '30 days' and o.user_id is not null
  group by o.user_id having count(*) >= 3
     and not exists (select 1 from public.fraud_flags f where f.entity_id = o.user_id and f.rule = 'refunds_30d' and f.status in ('open', 'investigating'));
  get diagnostics c = row_count; n := n + c;

  -- Customer: 6+ orders created within one hour.
  insert into public.fraud_flags (entity_type, entity_id, rule, severity, details)
  select 'user', user_id, 'order_velocity_1h', 'high', jsonb_build_object('orders_last_hour', count(*))
  from public.orders where created_at >= now() - interval '1 hour' and user_id is not null
  group by user_id having count(*) >= 6
     and not exists (select 1 from public.fraud_flags f where f.entity_id = orders.user_id and f.rule = 'order_velocity_1h' and f.status in ('open', 'investigating'));
  get diagnostics c = row_count; n := n + c;

  -- Restaurant: rejects or cancels 30%+ of its last 20+ paid orders.
  insert into public.fraud_flags (entity_type, entity_id, rule, severity, details)
  select 'restaurant', restaurant_id, 'high_rejection_rate', 'medium',
         jsonb_build_object('orders', count(*), 'rejected_or_cancelled', count(*) filter (where status in ('rejected', 'cancelled')))
  from (select restaurant_id, status, row_number() over (partition by restaurant_id order by created_at desc) rn
        from public.orders where status <> 'pending_payment' and created_at >= now() - interval '30 days') x
  where rn <= 50
  group by restaurant_id
  having count(*) >= 20 and count(*) filter (where status in ('rejected', 'cancelled')) >= 0.3 * count(*)
     and not exists (select 1 from public.fraud_flags f where f.entity_id = x.restaurant_id and f.rule = 'high_rejection_rate' and f.status in ('open', 'investigating'));
  get diagnostics c = row_count; n := n + c;

  -- Customer: 3+ failed payments in 24 hours (card testing).
  insert into public.fraud_flags (entity_type, entity_id, rule, severity, details)
  select 'user', o.user_id, 'failed_payments_24h', 'high', jsonb_build_object('failed', count(*))
  from public.payments p join public.orders o on o.id = p.order_id
  where p.status = 'failed' and p.created_at >= now() - interval '24 hours' and o.user_id is not null
  group by o.user_id having count(*) >= 3
     and not exists (select 1 from public.fraud_flags f where f.entity_id = o.user_id and f.rule = 'failed_payments_24h' and f.status in ('open', 'investigating'));
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- Admin user lookup (reads auth emails, so admin-only and security definer).
create or replace function public.admin_find_users(p_query text, p_limit integer default 50)
returns table (id uuid, email text, display_name text, roles text[], created_at timestamptz, orders bigint,
               refunds bigint, open_flags bigint, deletion_requested_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, p.display_name,
         coalesce((select array_agg(r.role::text order by r.role) from public.user_roles r where r.user_id = u.id), '{}'),
         u.created_at,
         (select count(*) from public.orders o where o.user_id = u.id and o.status <> 'pending_payment'),
         (select count(*) from public.refunds rf join public.orders o on o.id = rf.order_id where o.user_id = u.id),
         (select count(*) from public.fraud_flags f where f.entity_id = u.id and f.status in ('open', 'investigating')),
         p.deletion_requested_at
  from auth.users u left join public.profiles p on p.id = u.id
  where coalesce(trim(p_query), '') = '' or u.email ilike '%' || trim(p_query) || '%' or p.display_name ilike '%' || trim(p_query) || '%'
        or u.id::text = trim(p_query)
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 200);
end $$;

-- Refunds: admins approve requested refunds (queued for execution with the payment provider,
-- Phase 7), reject them, or create partial/full refunds. Total refunds can never exceed what was paid.
create or replace function public.admin_create_refund(p_order_id uuid, p_amount_cents integer, p_reason text, p_details text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_paid integer; v_refunded integer; v_payment uuid; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  select id, amount_cents into v_payment, v_paid from public.payments where order_id = p_order_id and status in ('succeeded', 'partially_refunded') order by created_at desc limit 1;
  if v_payment is null then raise exception 'No successful payment for this order' using errcode = 'P0001'; end if;
  select coalesce(sum(amount_cents), 0) into v_refunded from public.refunds where order_id = p_order_id and status not in ('failed', 'rejected');
  if p_amount_cents <= 0 or p_amount_cents + v_refunded > v_paid then
    raise exception 'Refund exceeds the remaining paid amount (% cents available)', v_paid - v_refunded using errcode = 'P0001';
  end if;
  insert into public.refunds (order_id, payment_id, amount_cents, reason, details, status, initiated_by, approved_by)
  values (p_order_id, v_payment, p_amount_cents, p_reason, p_details, 'pending', auth.uid(), auth.uid()) returning id into v_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'refund_created', 'order', p_order_id::text, jsonb_build_object('refund_id', v_id, 'amount_cents', p_amount_cents, 'reason', p_reason));
  return v_id;
end $$;

create or replace function public.admin_decide_refund(p_refund_id uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.refunds;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  select * into v from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  if v.status <> 'requested' then raise exception 'Refund already decided (%)', v.status using errcode = 'P0001'; end if;
  if not p_approve and coalesce(trim(p_notes), '') = '' then raise exception 'A reason is required to reject a refund' using errcode = '23514'; end if;
  update public.refunds set status = case when p_approve then 'pending' else 'rejected' end::public.refund_status,
         approved_by = auth.uid(), details = coalesce(p_notes, details) where id = p_refund_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), case when p_approve then 'refund_approved' else 'refund_rejected' end, 'refund', p_refund_id::text, jsonb_build_object('notes', p_notes));
end $$;

-- Content reports and appeals.
create or replace function public.admin_resolve_report(p_report_id uuid, p_remove_content boolean, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.content_reports;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  select * into r from public.content_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if p_remove_content then
    case r.target_type
      when 'video' then update public.videos set status = 'removed', moderation_notes = p_notes where id = r.target_id;
      when 'comment' then update public.video_comments set is_hidden = true where id = r.target_id;
      when 'menu_item' then update public.menu_items set is_available = false where id = r.target_id;
      when 'restaurant' then update public.restaurants set status = 'suspended' where id = r.target_id;
      else null;
    end case;
  end if;
  -- Resolve every open report on the same target together.
  update public.content_reports set status = case when p_remove_content then 'actioned' else 'dismissed' end,
         reviewed_by = auth.uid(), decision_notes = p_notes, decided_at = now()
   where target_type = r.target_type and target_id = r.target_id and status in ('open', 'in_review');
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), case when p_remove_content then 'content_removed' else 'report_dismissed' end, r.target_type, r.target_id::text,
          jsonb_build_object('report_id', p_report_id, 'notes', p_notes));
end $$;

create or replace function public.admin_decide_appeal(p_appeal_id uuid, p_overturn boolean, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.moderation_appeals;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  select * into a from public.moderation_appeals where id = p_appeal_id for update;
  if not found then raise exception 'Appeal not found' using errcode = 'P0002'; end if;
  if a.status <> 'open' then raise exception 'Appeal already decided' using errcode = 'P0001'; end if;
  if p_overturn and a.target_type = 'video' then
    -- Restores a video taken down after publication; never-published videos go back to review.
    update public.videos set status = case when playback_url is not null then 'published' else 'pending_review' end::public.video_status,
           moderation_notes = p_notes where id = a.target_id;
  elsif p_overturn and a.target_type = 'comment' then
    update public.video_comments set is_hidden = false where id = a.target_id;
  end if;
  update public.moderation_appeals set status = case when p_overturn then 'overturned' else 'upheld' end,
         reviewed_by = auth.uid(), decision_notes = p_notes, decided_at = now() where id = p_appeal_id;
  insert into public.notifications (user_id, type, title, body, data)
  values (a.appellant_id, 'moderation', case when p_overturn then 'Your appeal was successful' else 'Your appeal was reviewed' end, p_notes,
          jsonb_build_object('target_type', a.target_type, 'target_id', a.target_id));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), case when p_overturn then 'appeal_overturned' else 'appeal_upheld' end, a.target_type, a.target_id::text, jsonb_build_object('notes', p_notes));
end $$;

-- Platform settings, creator management and fraud flag resolution, all audited.
create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  if p_key not in ('default_commission_bps', 'service_fee', 'ranking_weights', 'privacy_policy_version') then
    raise exception 'Unknown setting %', p_key using errcode = '23514';
  end if;
  if p_key = 'default_commission_bps' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::int not between 0 and 5000) then
    raise exception 'Commission must be 0–5000 basis points' using errcode = '23514';
  end if;
  select value into v_old from public.platform_settings where key = p_key;
  insert into public.platform_settings (key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'setting_changed', 'platform_setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
end $$;

create or replace function public.admin_update_creator(p_creator_id uuid, p_verified boolean, p_affiliate public.affiliate_status, p_commission_bps integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  if p_affiliate = 'approved' and (p_commission_bps is null or p_commission_bps not between 0 and 3000) then
    raise exception 'Approved affiliates need a commission between 0 and 3000 bps' using errcode = '23514';
  end if;
  update public.creators set is_verified = p_verified, affiliate_status = p_affiliate,
         affiliate_commission_bps = case when p_affiliate = 'approved' then p_commission_bps else null end
   where user_id = p_creator_id;
  if not found then raise exception 'Creator not found' using errcode = 'P0002'; end if;
  insert into public.user_roles (user_id, role) values (p_creator_id, 'creator') on conflict do nothing;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'creator_updated', 'creator', p_creator_id::text,
          jsonb_build_object('verified', p_verified, 'affiliate', p_affiliate, 'commission_bps', p_commission_bps));
end $$;

create or replace function public.admin_resolve_fraud_flag(p_flag_id uuid, p_status text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  if p_status not in ('investigating', 'resolved', 'false_positive') then raise exception 'Invalid status' using errcode = '23514'; end if;
  update public.fraud_flags set status = p_status, resolved_by = auth.uid(),
         resolved_at = case when p_status = 'investigating' then null else now() end,
         details = details || jsonb_build_object('notes', p_notes) where id = p_flag_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'fraud_flag_' || p_status, 'fraud_flag', p_flag_id::text, jsonb_build_object('notes', p_notes));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'restaurant_sales_report(uuid, timestamptz, timestamptz)', 'admin_platform_metrics(timestamptz, timestamptz)',
    'recommendation_performance(integer)', 'run_fraud_rules()', 'admin_find_users(text, integer)',
    'admin_create_refund(uuid, integer, text, text)', 'admin_decide_refund(uuid, boolean, text)',
    'admin_resolve_report(uuid, boolean, text)', 'admin_decide_appeal(uuid, boolean, text)',
    'admin_set_setting(text, jsonb)', 'admin_update_creator(uuid, boolean, public.affiliate_status, integer)',
    'admin_resolve_fraud_flag(uuid, text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
