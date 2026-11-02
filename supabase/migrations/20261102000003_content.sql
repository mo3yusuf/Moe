-- Creators, videos, menu-item tagging, permissions and social graph.

create type public.video_status as enum ('uploading', 'processing', 'pending_review', 'published', 'rejected', 'removed');
create type public.video_source as enum ('creator', 'customer', 'restaurant');
create type public.link_status as enum ('pending', 'approved', 'rejected', 'revoked');
create type public.affiliate_status as enum ('none', 'applied', 'approved', 'rejected', 'suspended');

create table public.creators (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  handle           text not null unique check (handle ~ '^[a-z0-9_.]{3,30}$'),
  bio              text check (char_length(bio) <= 300),
  is_verified      boolean not null default false,
  affiliate_status public.affiliate_status not null default 'none',
  affiliate_applied_at timestamptz,
  affiliate_commission_bps integer check (affiliate_commission_bps between 0 and 3000),
  stripe_account_id text unique,
  created_at       timestamptz not null default now()
);

create or replace function public.protect_creator_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or public.request_is_privileged() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_verified := false;
    new.affiliate_status := 'none';
    new.affiliate_commission_bps := null;
    new.stripe_account_id := null;
    return new;
  end if;
  if new.is_verified is distinct from old.is_verified
     or new.affiliate_commission_bps is distinct from old.affiliate_commission_bps
     or new.stripe_account_id is distinct from old.stripe_account_id
     or (new.affiliate_status is distinct from old.affiliate_status
         and not (old.affiliate_status in ('none', 'rejected') and new.affiliate_status = 'applied')) then
    raise exception 'Only administrators can change creator verification or affiliate terms' using errcode = '42501';
  end if;
  if new.affiliate_status = 'applied' and old.affiliate_status <> 'applied' then
    new.affiliate_applied_at := now();
  end if;
  return new;
end $$;
create trigger creators_protect before insert or update on public.creators
  for each row execute function public.protect_creator_fields();

create table public.videos (
  id                uuid primary key default gen_random_uuid(),
  uploader_id       uuid not null references auth.users(id) on delete cascade,
  source            public.video_source not null default 'customer',
  restaurant_id     uuid references public.restaurants(id) on delete set null, -- tagged/owning restaurant
  storage_path      text,                    -- original upload in the "videos" bucket
  playback_url      text,                    -- HLS/MP4 URL from storage or a streaming provider
  stream_provider   text not null default 'supabase_storage',
  stream_asset_id   text,
  thumbnail_url     text,
  duration_ms       integer check (duration_ms between 1000 and 180000),
  caption           text check (char_length(caption) <= 500),
  hashtags          text[] not null default '{}',
  status            public.video_status not null default 'uploading',
  moderation_notes  text,
  -- Advertising disclosure (ACCC influencer guidance): sponsored content must be labelled.
  is_sponsored      boolean not null default false,
  sponsor_disclosure text,
  -- Uploader attests they own or are licensed to use the content (incl. music).
  rights_attested_at timestamptz,
  allow_restaurant_reuse boolean not null default false,
  created_at        timestamptz not null default now(),
  published_at      timestamptz,
  updated_at        timestamptz not null default now(),
  check (not is_sponsored or sponsor_disclosure is not null),
  check (status in ('uploading', 'processing', 'rejected', 'removed') or rights_attested_at is not null)
);
create index videos_status_published_idx on public.videos (status, published_at desc);
create index videos_uploader_idx on public.videos (uploader_id);
create index videos_restaurant_idx on public.videos (restaurant_id);
create trigger videos_updated_at before update on public.videos
  for each row execute function public.set_updated_at();

-- Uploaders can edit caption/rights/disclosure, and submit for review; moderation outcomes are admin-only.
create or replace function public.protect_video_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or public.request_is_privileged() then
    if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'uploading';
    new.published_at := null;
    new.moderation_notes := null;
    new.playback_url := null;
    if new.source = 'restaurant' and (new.restaurant_id is null
        or not public.is_restaurant_member(new.restaurant_id)) then
      raise exception 'Only restaurant members can upload restaurant videos' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     and not (old.status in ('uploading', 'processing') and new.status = 'pending_review')
     and not (new.status = 'removed') then  -- uploader may always take their video down
    raise exception 'Video status can only be changed by moderation' using errcode = '42501';
  end if;
  if new.playback_url is distinct from old.playback_url or new.moderation_notes is distinct from old.moderation_notes
     or new.published_at is distinct from old.published_at or new.source is distinct from old.source then
    raise exception 'Protected video fields cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger videos_protect before insert or update on public.videos
  for each row execute function public.protect_video_fields();

-- Video <-> menu item tags. Only 'approved' links make a video directly orderable.
create table public.video_menu_items (
  video_id      uuid not null references public.videos(id) on delete cascade,
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  status        public.link_status not null default 'pending',
  is_primary    boolean not null default true,
  requested_by  uuid references auth.users(id),
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  primary key (video_id, menu_item_id)
);
create index video_menu_items_item_idx on public.video_menu_items (menu_item_id);
create index video_menu_items_restaurant_status_idx on public.video_menu_items (restaurant_id, status);

-- Restaurant-to-creator permissions (e.g. auto-approve tags from a trusted creator).
create table public.creator_permissions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  creator_id    uuid not null references public.creators(user_id) on delete cascade,
  scope         text not null check (scope in ('auto_approve_tags', 'content_reuse', 'affiliate')),
  granted_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (restaurant_id, creator_id, scope)
);

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
    if v_privileged then
      return new;
    end if;
    if public.is_restaurant_member(v_item_restaurant, array['owner','manager']::public.restaurant_member_role[]) then
      new.status := 'approved';
      new.decided_by := auth.uid();
      new.decided_at := now();
    elsif v_uploader = auth.uid() and exists (
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
create trigger video_menu_items_prepare before insert or update on public.video_menu_items
  for each row execute function public.prepare_video_menu_item();

-- Social graph -------------------------------------------------------------
create table public.restaurant_follows (
  user_id       uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);
create index restaurant_follows_restaurant_idx on public.restaurant_follows (restaurant_id);

create table public.creator_follows (
  user_id    uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references public.creators(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, creator_id),
  check (user_id <> creator_id)
);
create index creator_follows_creator_idx on public.creator_follows (creator_id);

create table public.video_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  video_id   uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index video_likes_video_idx on public.video_likes (video_id);

create table public.video_comments (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references public.videos(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  parent_id  uuid references public.video_comments(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  is_hidden  boolean not null default false,
  created_at timestamptz not null default now()
);
create index video_comments_video_idx on public.video_comments (video_id, created_at);

-- "Cravings" = auto-saved from right swipes. "saved" = explicit bookmark.
create table public.saved_meals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  collection   text not null default 'cravings' check (collection in ('cravings', 'saved')),
  video_id     uuid references public.videos(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  created_at   timestamptz not null default now(),
  check (video_id is not null or menu_item_id is not null)
);
create unique index saved_meals_unique_idx on public.saved_meals
  (user_id, collection, coalesce(video_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(menu_item_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Aggregated counters, maintained by triggers / background jobs (never by clients).
create table public.video_stats (
  video_id     uuid primary key references public.videos(id) on delete cascade,
  impressions  bigint not null default 0,
  views_3s     bigint not null default 0,
  completions  bigint not null default 0,
  likes        bigint not null default 0,
  comments     bigint not null default 0,
  shares       bigint not null default 0,
  right_swipes bigint not null default 0,
  left_swipes  bigint not null default 0,
  order_clicks bigint not null default 0,
  orders       bigint not null default 0,
  revenue_cents bigint not null default 0,
  updated_at   timestamptz not null default now()
);

create or replace function public.ensure_video_stats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.video_stats (video_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger videos_stats_row after insert on public.videos
  for each row execute function public.ensure_video_stats();

create or replace function public.bump_like_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.video_stats set likes = likes + 1, updated_at = now() where video_id = new.video_id;
  else
    update public.video_stats set likes = greatest(likes - 1, 0), updated_at = now() where video_id = old.video_id;
  end if;
  return null;
end $$;
create trigger video_likes_count after insert or delete on public.video_likes
  for each row execute function public.bump_like_count();
