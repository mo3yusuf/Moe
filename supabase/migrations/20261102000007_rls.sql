-- =============================================================================
-- CRAVE — Row-level security. Every public table has RLS enabled.
-- =============================================================================
-- Roles (Supabase): anon (signed out), authenticated (signed in), service_role
-- (CRAVE API only, bypasses RLS). Tables with no write policy are read-only for
-- clients; their writes happen exclusively through the API.

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Helper: is the restaurant publicly visible?
create or replace function public.restaurant_is_public(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.restaurants where id = rid and status = 'active');
$$;

create or replace function public.can_view_restaurant(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.restaurant_is_public(rid) or public.is_restaurant_member(rid) or public.is_admin();
$$;

-- ---------------------------------------------------------------- markets
create policy markets_read on public.markets for select using (true);
create policy markets_admin on public.markets for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- profiles
create policy profiles_read on public.profiles for select
  using (deleted_at is null and (visibility = 'public' or id = auth.uid()) or public.is_admin());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on public.profiles for update using (public.is_admin());

-- ---------------------------------------------------------------- roles
create policy user_roles_read_own on public.user_roles for select using (user_id = auth.uid() or public.is_admin());
create policy user_roles_admin on public.user_roles for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- preferences & consents (owner only)
create policy user_preferences_own on public.user_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy privacy_consents_read_own on public.privacy_consents for select using (user_id = auth.uid() or public.is_admin());
create policy privacy_consents_insert_own on public.privacy_consents for insert with check (user_id = auth.uid() and source = 'app');

-- ---------------------------------------------------------------- restaurants
create policy restaurants_read on public.restaurants for select
  using (status = 'active' or created_by = auth.uid() or public.is_restaurant_member(id) or public.is_admin());
create policy restaurants_insert on public.restaurants for insert to authenticated with check (true);
create policy restaurants_update_manager on public.restaurants for update
  using (public.is_restaurant_member(id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(id, 'manager') or public.is_admin());

create policy restaurant_members_read on public.restaurant_members for select
  using (user_id = auth.uid() or public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());
create policy restaurant_members_owner_manage on public.restaurant_members for all
  using (public.is_restaurant_member(restaurant_id, 'owner') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'owner') or public.is_admin());

create policy restaurant_locations_read on public.restaurant_locations for select using (public.can_view_restaurant(restaurant_id));
create policy restaurant_locations_manage on public.restaurant_locations for all
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());

create policy restaurant_verifications_read on public.restaurant_verifications for select
  using (public.is_restaurant_member(restaurant_id, 'owner') or public.is_admin());
create policy restaurant_verifications_submit on public.restaurant_verifications for insert
  with check (public.is_restaurant_member(restaurant_id, 'owner'));
create policy restaurant_verifications_admin on public.restaurant_verifications for update using (public.is_admin()) with check (public.is_admin());

create policy opening_hours_read on public.opening_hours for select
  using (exists (select 1 from public.restaurant_locations l where l.id = location_id and public.can_view_restaurant(l.restaurant_id)));
create policy opening_hours_manage on public.opening_hours for all
  using (exists (select 1 from public.restaurant_locations l where l.id = location_id and (public.is_restaurant_member(l.restaurant_id, 'manager') or public.is_admin())))
  with check (exists (select 1 from public.restaurant_locations l where l.id = location_id and (public.is_restaurant_member(l.restaurant_id, 'manager') or public.is_admin())));

create policy special_closures_read on public.special_closures for select
  using (exists (select 1 from public.restaurant_locations l where l.id = location_id and public.can_view_restaurant(l.restaurant_id)));
create policy special_closures_manage on public.special_closures for all
  using (exists (select 1 from public.restaurant_locations l where l.id = location_id and (public.is_restaurant_member(l.restaurant_id, 'manager') or public.is_admin())))
  with check (exists (select 1 from public.restaurant_locations l where l.id = location_id and (public.is_restaurant_member(l.restaurant_id, 'manager') or public.is_admin())));

-- ---------------------------------------------------------------- menus (public read when restaurant active)
create policy menus_read on public.menus for select using (public.can_view_restaurant(restaurant_id));
create policy menus_manage on public.menus for all
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());

create policy menu_categories_read on public.menu_categories for select using (public.can_view_restaurant(restaurant_id));
create policy menu_categories_manage on public.menu_categories for all
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());

create policy menu_items_read on public.menu_items for select using (public.can_view_restaurant(restaurant_id));
create policy menu_items_manage on public.menu_items for all
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());
-- Staff can toggle availability (e.g. "sold out") but not edit prices: enforced in API; RLS allows staff update of the row.
create policy menu_items_staff_availability on public.menu_items for update
  using (public.is_restaurant_member(restaurant_id, 'staff'))
  with check (public.is_restaurant_member(restaurant_id, 'staff'));

create policy modifier_groups_read on public.modifier_groups for select using (public.can_view_restaurant(restaurant_id));
create policy modifier_groups_manage on public.modifier_groups for all
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());
create policy modifier_options_read on public.modifier_options for select using (public.can_view_restaurant(restaurant_id));
create policy modifier_options_manage on public.modifier_options for all
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());
create policy menu_item_media_read on public.menu_item_media for select using (public.can_view_restaurant(restaurant_id));
create policy menu_item_media_manage on public.menu_item_media for all
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());

-- ---------------------------------------------------------------- creators
create policy creator_profiles_read on public.creator_profiles for select using (true);
create policy creator_profiles_insert_own on public.creator_profiles for insert with check (user_id = auth.uid());
create policy creator_profiles_update_own on public.creator_profiles for update
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy creator_permissions_read on public.creator_permissions for select
  using (creator_id = auth.uid() or public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());
create policy creator_permissions_manage on public.creator_permissions for all
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());

-- ---------------------------------------------------------------- videos
create policy videos_read on public.videos for select
  using (status = 'published' or uploader_id = auth.uid()
         or (restaurant_id is not null and public.is_restaurant_member(restaurant_id)) or public.is_admin());
create policy videos_insert_own on public.videos for insert to authenticated with check (uploader_id = auth.uid());
create policy videos_update_own on public.videos for update using (uploader_id = auth.uid() or public.is_admin())
  with check (uploader_id = auth.uid() or public.is_admin());
create policy videos_delete_own on public.videos for delete using (uploader_id = auth.uid() or public.is_admin());

create policy video_menu_items_read on public.video_menu_items for select
  using (status = 'approved'
         or requested_by = auth.uid()
         or exists (select 1 from public.videos v where v.id = video_id and v.uploader_id = auth.uid())
         or public.is_restaurant_member(restaurant_id) or public.is_admin());
create policy video_menu_items_insert on public.video_menu_items for insert to authenticated with check (true); -- trigger enforces who
create policy video_menu_items_review on public.video_menu_items for update
  using (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin())
  with check (public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());
create policy video_menu_items_delete on public.video_menu_items for delete
  using (exists (select 1 from public.videos v where v.id = video_id and v.uploader_id = auth.uid())
         or public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());

-- ---------------------------------------------------------------- social
create policy user_follows_read on public.user_follows for select using (true);
create policy user_follows_own on public.user_follows for insert with check (follower_id = auth.uid());
create policy user_follows_delete_own on public.user_follows for delete using (follower_id = auth.uid());

create policy restaurant_follows_read_own on public.restaurant_follows for select
  using (user_id = auth.uid() or public.is_admin());
create policy restaurant_follows_own on public.restaurant_follows for insert with check (user_id = auth.uid());
create policy restaurant_follows_delete_own on public.restaurant_follows for delete using (user_id = auth.uid());

create policy video_likes_read_own on public.video_likes for select using (user_id = auth.uid());
create policy video_likes_own on public.video_likes for insert with check (user_id = auth.uid());
create policy video_likes_delete_own on public.video_likes for delete using (user_id = auth.uid());

create policy comments_read on public.comments for select
  using ((status = 'visible' and exists (select 1 from public.videos v where v.id = video_id and v.status = 'published'))
         or user_id = auth.uid() or public.is_admin());
create policy comments_insert on public.comments for insert to authenticated with check (user_id = auth.uid());
create policy comments_delete_own on public.comments for delete using (user_id = auth.uid() or public.is_admin());
create policy comments_admin on public.comments for update using (public.is_admin());

create policy saved_meals_own on public.saved_meals for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- recommendation data (owner read-only; API writes)
create policy video_interactions_read_own on public.video_interactions for select using (user_id = auth.uid());
create policy swipe_events_read_own on public.swipe_events for select using (user_id = auth.uid());
create policy user_taste_profiles_read_own on public.user_taste_profiles for select using (user_id = auth.uid());
create policy recommendation_impressions_read_own on public.recommendation_impressions for select using (user_id = auth.uid());
create policy recommendation_scores_read_own on public.recommendation_scores for select using (user_id = auth.uid());
create policy recommendation_configs_admin on public.recommendation_configs for all using (public.is_admin()) with check (public.is_admin());
create policy video_trending_scores_read on public.video_trending_scores for select using (true);

-- ---------------------------------------------------------------- commerce
create policy platform_settings_read on public.platform_settings for select using (true);
create policy platform_settings_admin on public.platform_settings for all using (public.is_admin()) with check (public.is_admin());

create policy commission_agreements_read on public.commission_agreements for select
  using (public.is_restaurant_member(restaurant_id, 'owner') or public.is_admin());
create policy commission_agreements_admin on public.commission_agreements for all using (public.is_admin()) with check (public.is_admin());

create policy customer_addresses_own on public.customer_addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy baskets_own on public.baskets for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy basket_items_own on public.basket_items for all
  using (exists (select 1 from public.baskets b where b.id = basket_id and b.user_id = auth.uid()))
  with check (exists (select 1 from public.baskets b where b.id = basket_id and b.user_id = auth.uid()));

-- Orders: read-only for customers (own) and restaurant members (their restaurant). Writes via API only.
create policy orders_read on public.orders for select
  using (customer_id = auth.uid() or public.is_restaurant_member(restaurant_id) or public.is_admin());
create policy order_items_read on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.customer_id = auth.uid() or public.is_restaurant_member(o.restaurant_id) or public.is_admin())));
create policy order_item_options_read on public.order_item_options for select
  using (exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id where oi.id = order_item_id
                 and (o.customer_id = auth.uid() or public.is_restaurant_member(o.restaurant_id) or public.is_admin())));
create policy order_status_history_read on public.order_status_history for select
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.customer_id = auth.uid() or public.is_restaurant_member(o.restaurant_id) or public.is_admin())));

create policy payments_read on public.payments for select
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.customer_id = auth.uid() or public.is_restaurant_member(o.restaurant_id, 'owner') or public.is_admin())));
create policy refunds_read on public.refunds for select
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.customer_id = auth.uid() or public.is_restaurant_member(o.restaurant_id, 'owner') or public.is_admin())));
create policy disputes_read on public.disputes for select using (public.is_admin());
create policy payment_webhook_events_admin on public.payment_webhook_events for select using (public.is_admin());
create policy restaurant_payouts_read on public.restaurant_payouts for select
  using (public.is_restaurant_member(restaurant_id, 'owner') or public.is_admin());
create policy ledger_entries_read on public.ledger_entries for select
  using ((restaurant_id is not null and public.is_restaurant_member(restaurant_id, 'owner')) or public.is_admin());

create policy creator_attributions_read on public.creator_attributions for select
  using (creator_id = auth.uid() or public.is_restaurant_member(restaurant_id, 'manager') or public.is_admin());
create policy creator_commissions_read on public.creator_commissions for select using (creator_id = auth.uid() or public.is_admin());

create policy delivery_providers_read on public.delivery_providers for select using (true);
create policy delivery_providers_admin on public.delivery_providers for all using (public.is_admin()) with check (public.is_admin());
create policy delivery_jobs_read on public.delivery_jobs for select
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.customer_id = auth.uid() or public.is_restaurant_member(o.restaurant_id) or public.is_admin())));

-- ---------------------------------------------------------------- moderation & admin
create policy moderation_reports_insert on public.moderation_reports for insert to authenticated with check (true);
create policy moderation_reports_read on public.moderation_reports for select using (reporter_id = auth.uid() or public.is_admin());
create policy moderation_reports_admin on public.moderation_reports for update using (public.is_admin()) with check (public.is_admin());

create policy moderation_actions_read on public.moderation_actions for select using (public.is_admin());
create policy moderation_actions_admin on public.moderation_actions for insert with check (public.is_admin());

create policy moderation_appeals_own on public.moderation_appeals for select using (user_id = auth.uid() or public.is_admin());
create policy moderation_appeals_insert on public.moderation_appeals for insert with check (user_id = auth.uid());
create policy moderation_appeals_admin on public.moderation_appeals for update using (public.is_admin()) with check (public.is_admin());

create policy fraud_flags_admin on public.fraud_flags for all using (public.is_admin()) with check (public.is_admin());
create policy notifications_own on public.notifications for select using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_tokens_own on public.push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy account_deletion_requests_own on public.account_deletion_requests for select using (user_id = auth.uid() or public.is_admin());
create policy admin_audit_log_admin on public.admin_audit_log for select using (public.is_admin());

-- Functions callable by clients
revoke execute on function public.refresh_trending_scores() from public, anon, authenticated;
revoke execute on function public.purge_old_interaction_events(interval) from public, anon, authenticated;
revoke execute on function public.anonymise_user_for_deletion(uuid) from public, anon, authenticated;
grant execute on function public.reset_my_taste_profile() to authenticated;
