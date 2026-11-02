-- Security hardening from the Phase 7 review.

-- has_consent() is SECURITY DEFINER and took any user id, letting a signed-in user read another
-- user's consent choices. Restrict it to the user themselves, admins and the backend.
create or replace function public.has_consent(p_user_id uuid, p_type text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.request_is_privileged() or p_user_id = auth.uid() or public.is_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select granted from public.privacy_consents
    where user_id = p_user_id and consent_type = p_type
    order by created_at desc, id desc limit 1), false);
end $$;
revoke execute on function public.has_consent(uuid, text) from public, anon;
grant execute on function public.has_consent(uuid, text) to authenticated, service_role;

-- Webhook payloads can contain customer details: admin/backend only (RLS already denies others;
-- this also removes the table-level grant for defence in depth).
revoke all on public.webhook_events from anon, authenticated;
grant select on public.webhook_events to authenticated; -- still filtered to admins by RLS (admin_all)

-- Defence in depth: bump_video_stats was protected only by execute grants; guard it in-function too.
create or replace function public.bump_video_stats(
  p_video_id uuid,
  p_impressions integer default 0, p_views_3s integer default 0, p_completions integer default 0,
  p_shares integer default 0, p_right_swipes integer default 0, p_left_swipes integer default 0,
  p_order_clicks integer default 0
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Backend only' using errcode = '42501'; end if;
  insert into public.video_stats (video_id, impressions, views_3s, completions, shares, right_swipes, left_swipes, order_clicks)
  values (p_video_id, greatest(p_impressions, 0), greatest(p_views_3s, 0), greatest(p_completions, 0),
          greatest(p_shares, 0), greatest(p_right_swipes, 0), greatest(p_left_swipes, 0), greatest(p_order_clicks, 0))
  on conflict (video_id) do update set
    impressions  = video_stats.impressions + excluded.impressions,
    views_3s     = video_stats.views_3s + excluded.views_3s,
    completions  = video_stats.completions + excluded.completions,
    shares       = video_stats.shares + excluded.shares,
    right_swipes = greatest(video_stats.right_swipes + p_right_swipes, 0),
    left_swipes  = greatest(video_stats.left_swipes + p_left_swipes, 0),
    order_clicks = video_stats.order_clicks + excluded.order_clicks,
    updated_at   = now();
end $$;
