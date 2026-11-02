-- Callable functions (RPC) for privacy controls and merchant operations.

-- Reset My Taste Profile -------------------------------------------------------
-- Deletes behavioural recommendation data for the calling user and marks a reset point so that
-- older orders are ignored by the ranking engine. Order/payment records are retained because
-- they are financial records (tax law retention), but no longer influence recommendations.
create or replace function public.reset_taste_profile(
  p_clear_cravings boolean default false,
  p_clear_explicit_preferences boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_swipes int; v_interactions int; v_searches int; v_affinities int;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  delete from public.swipe_events where user_id = v_uid;            get diagnostics v_swipes = row_count;
  delete from public.video_interactions where user_id = v_uid;      get diagnostics v_interactions = row_count;
  delete from public.search_events where user_id = v_uid;           get diagnostics v_searches = row_count;
  delete from public.user_feature_affinities where user_id = v_uid; get diagnostics v_affinities = row_count;
  delete from public.recommendation_scores where user_id = v_uid;
  delete from public.recommendation_impressions where user_id = v_uid;
  if p_clear_cravings then
    delete from public.saved_meals where user_id = v_uid and collection = 'cravings';
  end if;
  if p_clear_explicit_preferences then
    delete from public.user_taste_preferences where user_id = v_uid;
  end if;
  update public.profiles set taste_reset_at = now() where id = v_uid;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (v_uid, 'taste_profile_reset', 'user', v_uid::text,
          jsonb_build_object('cravings_cleared', p_clear_cravings, 'preferences_cleared', p_clear_explicit_preferences));

  return jsonb_build_object('swipes_deleted', v_swipes, 'interactions_deleted', v_interactions,
                            'searches_deleted', v_searches, 'affinities_deleted', v_affinities);
end $$;

-- Account deletion request ------------------------------------------------------
-- Records the request and immediately hides the profile. The backend worker then deletes the
-- auth user (cascading personal data) after any in-flight orders are settled.
create or replace function public.request_account_deletion() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select id into v_id from public.data_deletion_requests
    where user_id = v_uid and request_type = 'account_deletion' and status in ('received', 'processing');
  if v_id is not null then return v_id; end if;
  insert into public.data_deletion_requests (user_id, request_type) values (v_uid, 'account_deletion')
    returning id into v_id;
  update public.profiles set deletion_requested_at = now() where id = v_uid;
  return v_id;
end $$;

-- Merchant operations ----------------------------------------------------------------
-- Merchant-initiated order transitions. Payment-related transitions (pending_payment -> placed)
-- are performed only by the backend after the payment provider confirms.
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
                                   then now() + make_interval(mins => (select prep_time_minutes from public.restaurant_locations where id = v_order.location_id))
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

create or replace function public.set_menu_item_availability(p_menu_item_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_restaurant_member((select restaurant_id from public.menu_items where id = p_menu_item_id)) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  update public.menu_items set is_available = p_available where id = p_menu_item_id;
end $$;

create or replace function public.set_location_accepting_orders(p_location_id uuid, p_accepting boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_restaurant_member((select restaurant_id from public.restaurant_locations where id = p_location_id)) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  update public.restaurant_locations set is_accepting_orders = p_accepting where id = p_location_id;
end $$;

-- Admin operations ---------------------------------------------------------------------
create or replace function public.admin_decide_verification(
  p_verification_id uuid, p_approve boolean, p_notes text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_restaurant uuid;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  update public.restaurant_verifications
     set status = case when p_approve then 'approved' else 'rejected' end::public.verification_status,
         reviewer_id = auth.uid(), reviewer_notes = p_notes, decided_at = now()
   where id = p_verification_id
   returning restaurant_id into v_restaurant;
  if v_restaurant is null then raise exception 'Verification not found' using errcode = 'P0002'; end if;
  update public.restaurants set status = case when p_approve then 'verified' else 'rejected' end::public.restaurant_status
   where id = v_restaurant;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), case when p_approve then 'restaurant_verified' else 'restaurant_rejected' end,
          'restaurant', v_restaurant::text, jsonb_build_object('notes', p_notes));
end $$;

create or replace function public.admin_set_commission(p_restaurant_id uuid, p_bps integer, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old integer;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  if p_bps < 0 or p_bps > 5000 then raise exception 'Commission out of range' using errcode = '23514'; end if;
  select commission_rate_bps into v_old from public.restaurants where id = p_restaurant_id for update;
  update public.restaurants set commission_rate_bps = p_bps where id = p_restaurant_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'commission_changed', 'restaurant', p_restaurant_id::text,
          jsonb_build_object('from_bps', v_old, 'to_bps', p_bps, 'reason', p_reason));
end $$;

create or replace function public.admin_moderate_video(p_video_id uuid, p_status public.video_status, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  if p_status not in ('published', 'rejected', 'removed') then
    raise exception 'Invalid moderation outcome' using errcode = '23514';
  end if;
  update public.videos set status = p_status, moderation_notes = p_notes where id = p_video_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'video_moderated', 'video', p_video_id::text, jsonb_build_object('status', p_status, 'notes', p_notes));
end $$;

-- Execute grants for functions created in this migration.
revoke execute on function public.admin_decide_verification(uuid, boolean, text) from anon;
revoke execute on function public.admin_set_commission(uuid, integer, text) from anon;
revoke execute on function public.admin_moderate_video(uuid, public.video_status, text) from anon;
grant execute on function public.reset_taste_profile(boolean, boolean) to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.restaurant_update_order_status(uuid, public.order_status, text) to authenticated;
grant execute on function public.set_menu_item_availability(uuid, boolean) to authenticated;
grant execute on function public.set_location_accepting_orders(uuid, boolean) to authenticated;
grant execute on function public.admin_decide_verification(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_commission(uuid, integer, text) to authenticated;
grant execute on function public.admin_moderate_video(uuid, public.video_status, text) to authenticated;
