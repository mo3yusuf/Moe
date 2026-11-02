-- Row-level security. Default-deny: every public table has RLS enabled, and access is
-- granted only by the policies below. The backend uses the service role for privileged writes
-- (orders, payments, ranking outputs) and never exposes that key to clients.

-- Grants (explicit, rather than relying on platform defaults). RLS still applies.
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Enable RLS everywhere.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Administrators get full access to every table (still subject to triggers / state machines).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format(
      'create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t.tablename);
  end loop;
end $$;

-- Helpers ----------------------------------------------------------------------
create or replace function public.restaurant_visible(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.restaurants where id = p_restaurant_id and status = 'verified')
      or public.is_restaurant_member(p_restaurant_id)
      or public.is_admin();
$$;

create or replace function public.can_manage_restaurant(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_restaurant_member(p_restaurant_id, array['owner','manager']::public.restaurant_member_role[]);
$$;

create or replace function public.can_view_order(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (o.user_id = auth.uid() or public.is_restaurant_member(o.restaurant_id) or public.is_admin())
  );
$$;

-- Reference data ---------------------------------------------------------------
create policy countries_read on public.countries for select using (true);
create policy cities_read on public.cities for select using (true);

-- Profiles: full row visible to self only; others use the public_profiles view.
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create or replace view public.public_profiles as
  select p.id, p.display_name, p.username, p.avatar_url, p.bio
  from public.profiles p where p.deletion_requested_at is null;
grant select on public.public_profiles to anon, authenticated;

-- Prevent users from tampering with privacy/lifecycle columns directly.
-- Not SECURITY DEFINER on purpose: current_user is the caller's role for direct updates, but the
-- function owner when called from vetted RPCs (reset_taste_profile, request_account_deletion).
create or replace function public.protect_profile_fields() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.taste_reset_at is distinct from old.taste_reset_at
       or new.deletion_requested_at is distinct from old.deletion_requested_at then
      raise exception 'Use reset_taste_profile() / request_account_deletion()' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

create policy user_roles_self_read on public.user_roles for select to authenticated using (user_id = auth.uid());
-- platform_settings and audit_log: admin only (admin_all) — backend reads them with the service role.

-- Restaurants --------------------------------------------------------------------
create policy restaurants_read on public.restaurants for select
  using (status = 'verified' or public.is_restaurant_member(id) or created_by = auth.uid());
create policy restaurants_insert on public.restaurants for insert to authenticated
  with check (created_by = auth.uid());
create policy restaurants_update on public.restaurants for update to authenticated
  using (public.can_manage_restaurant(id)) with check (public.can_manage_restaurant(id));

-- Creator of a restaurant becomes its owner.
create or replace function public.add_restaurant_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.restaurant_members (restaurant_id, user_id, role)
    values (new.id, new.created_by, 'owner') on conflict do nothing;
    insert into public.user_roles (user_id, role) values (new.created_by, 'restaurant_staff')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger restaurants_add_owner after insert on public.restaurants
  for each row execute function public.add_restaurant_owner();

create policy members_read on public.restaurant_members for select to authenticated
  using (user_id = auth.uid() or public.can_manage_restaurant(restaurant_id));
create policy members_owner_write on public.restaurant_members for all to authenticated
  using (public.is_restaurant_member(restaurant_id, array['owner']::public.restaurant_member_role[]))
  with check (public.is_restaurant_member(restaurant_id, array['owner']::public.restaurant_member_role[]));

create policy locations_read on public.restaurant_locations for select using (public.restaurant_visible(restaurant_id));
create policy locations_write on public.restaurant_locations for all to authenticated
  using (public.can_manage_restaurant(restaurant_id)) with check (public.can_manage_restaurant(restaurant_id));
-- Staff (non-managers) pause/resume orders via set_location_accepting_orders().

create policy hours_read on public.location_opening_hours for select
  using (exists (select 1 from public.restaurant_locations l where l.id = location_id and public.restaurant_visible(l.restaurant_id)));
create policy hours_write on public.location_opening_hours for all to authenticated
  using (exists (select 1 from public.restaurant_locations l where l.id = location_id and public.can_manage_restaurant(l.restaurant_id)))
  with check (exists (select 1 from public.restaurant_locations l where l.id = location_id and public.can_manage_restaurant(l.restaurant_id)));

create policy closures_read on public.location_closures for select
  using (exists (select 1 from public.restaurant_locations l where l.id = location_id and public.restaurant_visible(l.restaurant_id)));
create policy closures_write on public.location_closures for all to authenticated
  using (exists (select 1 from public.restaurant_locations l where l.id = location_id and public.can_manage_restaurant(l.restaurant_id)))
  with check (exists (select 1 from public.restaurant_locations l where l.id = location_id and public.can_manage_restaurant(l.restaurant_id)));

create policy verifications_read on public.restaurant_verifications for select to authenticated
  using (public.is_restaurant_member(restaurant_id));
create policy verifications_submit on public.restaurant_verifications for insert to authenticated
  with check (public.can_manage_restaurant(restaurant_id) and submitted_by = auth.uid()
              and status = 'submitted' and reviewer_id is null and decided_at is null);

create policy certifications_read on public.restaurant_certifications for select
  using (public.restaurant_visible(restaurant_id));
create policy certifications_submit on public.restaurant_certifications for insert to authenticated
  with check (public.can_manage_restaurant(restaurant_id) and verified_at is null and verified_by is null);

create policy menus_read on public.menus for select using (public.restaurant_visible(restaurant_id));
create policy menus_write on public.menus for all to authenticated
  using (public.can_manage_restaurant(restaurant_id)) with check (public.can_manage_restaurant(restaurant_id));

create policy menu_items_read on public.menu_items for select using (public.restaurant_visible(restaurant_id));
create policy menu_items_write on public.menu_items for all to authenticated
  using (public.can_manage_restaurant(restaurant_id)) with check (public.can_manage_restaurant(restaurant_id));
-- Staff (non-managers) toggle availability via set_menu_item_availability().

create policy option_groups_read on public.menu_item_option_groups for select
  using (exists (select 1 from public.menu_items mi where mi.id = menu_item_id and public.restaurant_visible(mi.restaurant_id)));
create policy option_groups_write on public.menu_item_option_groups for all to authenticated
  using (exists (select 1 from public.menu_items mi where mi.id = menu_item_id and public.can_manage_restaurant(mi.restaurant_id)))
  with check (exists (select 1 from public.menu_items mi where mi.id = menu_item_id and public.can_manage_restaurant(mi.restaurant_id)));

create policy options_read on public.menu_item_options for select
  using (exists (select 1 from public.menu_item_option_groups g join public.menu_items mi on mi.id = g.menu_item_id
                 where g.id = group_id and public.restaurant_visible(mi.restaurant_id)));
create policy options_write on public.menu_item_options for all to authenticated
  using (exists (select 1 from public.menu_item_option_groups g join public.menu_items mi on mi.id = g.menu_item_id
                 where g.id = group_id and public.can_manage_restaurant(mi.restaurant_id)))
  with check (exists (select 1 from public.menu_item_option_groups g join public.menu_items mi on mi.id = g.menu_item_id
                 where g.id = group_id and public.can_manage_restaurant(mi.restaurant_id)));

-- Creators & content ---------------------------------------------------------------
create policy creators_read on public.creators for select using (true);
create policy creators_self_insert on public.creators for insert to authenticated with check (user_id = auth.uid());
create policy creators_self_update on public.creators for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy videos_read on public.videos for select
  using (status = 'published' or uploader_id = auth.uid()
         or (restaurant_id is not null and public.is_restaurant_member(restaurant_id)));
create policy videos_insert on public.videos for insert to authenticated with check (uploader_id = auth.uid());
create policy videos_update on public.videos for update to authenticated
  using (uploader_id = auth.uid()) with check (uploader_id = auth.uid());
create policy videos_delete on public.videos for delete to authenticated using (uploader_id = auth.uid());

create policy vmi_read on public.video_menu_items for select
  using ((status = 'approved' and exists (select 1 from public.videos v where v.id = video_id and v.status = 'published'))
         or requested_by = auth.uid()
         or exists (select 1 from public.videos v where v.id = video_id and v.uploader_id = auth.uid())
         or public.is_restaurant_member(restaurant_id));
create policy vmi_insert on public.video_menu_items for insert to authenticated
  with check (exists (select 1 from public.videos v where v.id = video_id and v.uploader_id = auth.uid())
              or public.can_manage_restaurant((select mi.restaurant_id from public.menu_items mi where mi.id = menu_item_id)));
create policy vmi_update on public.video_menu_items for update to authenticated
  using (public.can_manage_restaurant(restaurant_id)
         or exists (select 1 from public.videos v where v.id = video_id and v.uploader_id = auth.uid()));
create policy vmi_delete on public.video_menu_items for delete to authenticated
  using (exists (select 1 from public.videos v where v.id = video_id and v.uploader_id = auth.uid()));

create policy creator_permissions_read on public.creator_permissions for select to authenticated
  using (creator_id = auth.uid() or public.is_restaurant_member(restaurant_id));
create policy creator_permissions_write on public.creator_permissions for all to authenticated
  using (public.can_manage_restaurant(restaurant_id)) with check (public.can_manage_restaurant(restaurant_id));

create policy restaurant_follows_own on public.restaurant_follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy creator_follows_own on public.creator_follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy video_likes_own on public.video_likes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy comments_read on public.video_comments for select
  using (not is_hidden and exists (select 1 from public.videos v where v.id = video_id and v.status = 'published'));
create policy comments_insert on public.video_comments for insert to authenticated
  with check (user_id = auth.uid() and not is_hidden
              and exists (select 1 from public.videos v where v.id = video_id and v.status = 'published'));
create policy comments_delete_own on public.video_comments for delete to authenticated using (user_id = auth.uid());

create policy saved_meals_own on public.saved_meals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy video_stats_read on public.video_stats for select using (true);

-- Recommendation signals: users write and read only their own; derived tables are read-only to them.
create policy interactions_own_insert on public.video_interactions for insert to authenticated with check (user_id = auth.uid());
create policy interactions_own_read on public.video_interactions for select to authenticated using (user_id = auth.uid());
create policy swipes_own_insert on public.swipe_events for insert to authenticated with check (user_id = auth.uid());
create policy swipes_own_read on public.swipe_events for select to authenticated using (user_id = auth.uid());
create policy searches_own_insert on public.search_events for insert to authenticated with check (user_id = auth.uid());
create policy searches_own_read on public.search_events for select to authenticated using (user_id = auth.uid());
create policy taste_prefs_own on public.user_taste_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy affinities_own_read on public.user_feature_affinities for select to authenticated using (user_id = auth.uid());
create policy rec_scores_own_read on public.recommendation_scores for select to authenticated using (user_id = auth.uid());
create policy rec_impressions_own_read on public.recommendation_impressions for select to authenticated using (user_id = auth.uid());

-- Commerce ----------------------------------------------------------------------------
create policy baskets_own on public.baskets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy basket_items_own on public.basket_items for all to authenticated
  using (exists (select 1 from public.baskets b where b.id = basket_id and b.user_id = auth.uid()))
  with check (exists (select 1 from public.baskets b where b.id = basket_id and b.user_id = auth.uid() and b.status = 'active'));

-- Orders: no client INSERT/UPDATE policies. Creation is server-side; merchant status changes go
-- through restaurant_update_order_status(), which enforces membership and the state machine.
create policy orders_read on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_restaurant_member(restaurant_id));
create policy order_items_read on public.order_items for select to authenticated using (public.can_view_order(order_id));
create policy order_events_read on public.order_status_events for select to authenticated using (public.can_view_order(order_id));

create policy payments_read on public.payments for select to authenticated using (public.can_view_order(order_id));
create policy refunds_read on public.refunds for select to authenticated using (public.can_view_order(order_id));
create policy disputes_read on public.payment_disputes for select to authenticated
  using (exists (select 1 from public.payments p join public.orders o on o.id = p.order_id
                 where p.id = payment_id and public.can_manage_restaurant(o.restaurant_id)));
create policy payouts_read on public.restaurant_payouts for select to authenticated
  using (public.can_manage_restaurant(restaurant_id));
create policy attributions_read on public.creator_attributions for select to authenticated
  using (creator_id = auth.uid()
         or exists (select 1 from public.orders o where o.id = order_id and public.is_restaurant_member(o.restaurant_id)));
create policy creator_commissions_read on public.creator_commissions for select to authenticated
  using (creator_id = auth.uid());
-- webhook_events: service role / admin only.

-- Trust, privacy & support --------------------------------------------------------------
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
create policy push_tokens_own on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy consents_own_insert on public.privacy_consents for insert to authenticated with check (user_id = auth.uid());
create policy consents_own_read on public.privacy_consents for select to authenticated using (user_id = auth.uid());
create policy deletion_requests_own_read on public.data_deletion_requests for select to authenticated using (user_id = auth.uid());
create policy deletion_requests_own_insert on public.data_deletion_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'received');

create policy reports_insert on public.content_reports for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open' and reviewed_by is null);
create policy reports_own_read on public.content_reports for select to authenticated using (reporter_id = auth.uid());
create policy appeals_insert on public.moderation_appeals for insert to authenticated
  with check (appellant_id = auth.uid() and status = 'open');
create policy appeals_own_read on public.moderation_appeals for select to authenticated using (appellant_id = auth.uid());
-- fraud_flags: admin only.

create policy tickets_read on public.support_tickets for select to authenticated
  using (opened_by = auth.uid() or (restaurant_id is not null and public.is_restaurant_member(restaurant_id)));
create policy tickets_insert on public.support_tickets for insert to authenticated
  with check (opened_by = auth.uid() and status = 'open'
              and (restaurant_id is null or public.is_restaurant_member(restaurant_id)));
