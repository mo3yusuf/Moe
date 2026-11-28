-- Fix: a restaurant owner who is also a CRAVE admin had their own dish tags left "pending" (the
-- admin shortcut ran before the owner auto-approval), so their videos weren't linked to the dish and a
-- right swipe didn't open the order page. Owners/managers are now always approved first. Existing
-- pending tags that an owner/manager of that restaurant created are approved too.

create or replace function public.prepare_video_menu_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item_restaurant uuid;
  v_uploader uuid;
  v_privileged boolean := public.is_admin() or public.request_is_privileged();
begin
  select restaurant_id into v_item_restaurant from public.menu_items where id = new.menu_item_id;
  new.restaurant_id := v_item_restaurant;

  if tg_op = 'INSERT' then
    select uploader_id into v_uploader from public.videos where id = new.video_id;
    new.requested_by := coalesce(new.requested_by, auth.uid());
    -- The restaurant's own owner/manager tagging its own dish is approved straight away — including
    -- when that person is also a CRAVE admin (previously admins skipped this and stayed pending).
    if public.is_restaurant_member(v_item_restaurant, array['owner','manager']::public.restaurant_member_role[]) then
      new.status := 'approved';
      new.decided_by := auth.uid();
      new.decided_at := now();
      return new;
    end if;
    if v_privileged then
      return new;
    end if;
    if v_uploader = auth.uid() and exists (
        select 1 from public.creator_permissions p
        where p.restaurant_id = v_item_restaurant and p.creator_id = auth.uid()
          and p.scope = 'auto_approve_tags' and p.revoked_at is null) then
      new.status := 'approved';
      new.decided_at := now();
    else
      new.status := 'pending';
      new.decided_by := null;
      new.decided_at := null;
    end if;
    return new;
  end if;

  -- UPDATE: only restaurant managers (or admin) decide; the uploader may revoke their own tag.
  if new.status is distinct from old.status then
    if v_privileged or public.is_restaurant_member(old.restaurant_id, array['owner','manager']::public.restaurant_member_role[]) then
      new.decided_by := auth.uid();
      new.decided_at := now();
    elsif new.status = 'revoked' and (select uploader_id from public.videos where id = old.video_id) = auth.uid() then
      new.decided_at := now();
    else
      raise exception 'Only the restaurant can approve or reject menu tags' using errcode = '42501';
    end if;
  end if;
  if new.video_id <> old.video_id or new.menu_item_id <> old.menu_item_id then
    raise exception 'Links are immutable; delete and recreate instead' using errcode = '42501';
  end if;
  return new;
end $$;

update public.video_menu_items vmi
   set status = 'approved', decided_by = vmi.requested_by, decided_at = now()
 where vmi.status = 'pending'
   and exists (select 1 from public.restaurant_members m
               where m.restaurant_id = vmi.restaurant_id and m.user_id = vmi.requested_by and m.role in ('owner', 'manager'));
