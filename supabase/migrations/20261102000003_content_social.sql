-- =============================================================================
-- CRAVE — Creators, videos, menu-item links, permissions, social graph
-- =============================================================================

create type public.affiliate_status as enum ('none', 'applied', 'approved', 'rejected', 'suspended');
create type public.video_status as enum ('processing', 'published', 'hidden', 'removed', 'rejected');
create type public.video_uploader_kind as enum ('creator', 'restaurant');
create type public.video_rights_basis as enum ('own_content', 'licensed', 'restaurant_owned');
create type public.link_status as enum ('pending', 'approved', 'rejected');
create type public.creator_permission as enum ('auto_approve_tags', 'reuse_in_promotions');
create type public.comment_status as enum ('visible', 'hidden', 'removed');

create table public.creator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_verified boolean not null default false,
  affiliate_status public.affiliate_status not null default 'none',
  affiliate_applied_at timestamptz,
  instagram_handle text,                 -- self-declared, displayed only; we never import content
  tiktok_handle text,
  website_url text,
  total_views bigint not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_roles (user_id, role) values (new.user_id, 'creator') on conflict do nothing;
  return new;
end $$;
create trigger on_creator_created after insert on public.creator_profiles for each row execute function public.handle_new_creator();

create or replace function public.protect_creator_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.is_verified := false;
      new.total_views := 0;
      new.affiliate_status := case when new.affiliate_status = 'applied' then 'applied' else 'none' end;
    else
      new.is_verified := old.is_verified;
      new.total_views := old.total_views;
      -- Creators may only apply; approvals are made by CRAVE staff.
      if new.affiliate_status is distinct from old.affiliate_status
         and not (new.affiliate_status = 'applied' and old.affiliate_status in ('none', 'rejected')) then
        new.affiliate_status := old.affiliate_status;
      end if;
    end if;
    if new.affiliate_status = 'applied' and (tg_op = 'INSERT' or old.affiliate_status <> 'applied') then
      new.affiliate_applied_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger creator_profiles_protect before insert or update on public.creator_profiles for each row execute function public.protect_creator_columns();

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references auth.users(id) on delete cascade,
  uploader_kind public.video_uploader_kind not null default 'creator',
  -- For restaurant-uploaded videos, the restaurant that owns the video.
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  market_id uuid references public.markets(id),
  storage_path text,                     -- Supabase Storage path (or provider asset id)
  playback_url text,                     -- HLS/MP4 URL served to clients
  poster_url text,
  streaming_provider text not null default 'supabase_storage',  -- future: 'mux', 'cloudflare_stream'
  duration_ms integer check (duration_ms between 1000 and 600000),
  width integer,
  height integer,
  size_bytes bigint check (size_bytes > 0 and size_bytes <= 209715200),
  mime_type text check (mime_type in ('video/mp4', 'video/quicktime')),
  caption text not null default '' check (char_length(caption) <= 300),
  hashtags text[] not null default '{}',
  status public.video_status not null default 'processing',
  is_sponsored boolean not null default false,
  sponsor_disclosure text check (char_length(sponsor_disclosure) <= 120),
  rights_basis public.video_rights_basis not null default 'own_content',
  rights_confirmed_at timestamptz not null default now(),
  allow_restaurant_reuse boolean not null default false,
  comments_enabled boolean not null default true,
  is_demo boolean not null default false,
  view_count bigint not null default 0,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  save_count integer not null default 0,
  share_count integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_sponsored or sponsor_disclosure is not null),
  check (uploader_kind <> 'restaurant' or restaurant_id is not null)
);
create index videos_feed_idx on public.videos (market_id, published_at desc) where status = 'published';
create index videos_uploader_idx on public.videos (uploader_id, created_at desc);
create index videos_restaurant_idx on public.videos (restaurant_id, published_at desc) where status = 'published';
create index videos_hashtags_idx on public.videos using gin (hashtags);
create trigger videos_updated_at before update on public.videos for each row execute function public.set_updated_at();

create or replace function public.protect_video_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.uploader_id := auth.uid();
      new.status := 'processing';      -- the API publishes after validation/processing
      new.published_at := null;
      new.is_demo := false;
      new.view_count := 0; new.like_count := 0; new.comment_count := 0; new.save_count := 0; new.share_count := 0;
      if new.uploader_kind = 'restaurant' and not public.is_restaurant_member(new.restaurant_id, 'manager') then
        raise exception 'Only restaurant managers can upload restaurant videos' using errcode = '42501';
      end if;
    else
      -- Uploaders may edit caption/settings and hide their own video, nothing else.
      if new.status is distinct from old.status and not (new.status = 'hidden' and old.status = 'published')
         and not (new.status = 'published' and old.status = 'hidden') then
        raise exception 'Video status is managed by CRAVE' using errcode = '42501';
      end if;
      new.uploader_id := old.uploader_id; new.uploader_kind := old.uploader_kind; new.restaurant_id := old.restaurant_id;
      new.storage_path := old.storage_path; new.playback_url := old.playback_url; new.is_demo := old.is_demo;
      new.duration_ms := old.duration_ms; new.size_bytes := old.size_bytes; new.mime_type := old.mime_type;
      new.published_at := old.published_at;
      new.view_count := old.view_count; new.like_count := old.like_count; new.comment_count := old.comment_count;
      new.save_count := old.save_count; new.share_count := old.share_count;
    end if;
  end if;
  return new;
end $$;
create trigger videos_protect before insert or update on public.videos for each row execute function public.protect_video_columns();

-- Restaurant-level permissions granted to specific creators.
create table public.creator_permissions (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  permission public.creator_permission not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, creator_id, permission)
);

-- Video ↔ menu item tags. Only APPROVED links make the item orderable from the video.
create table public.video_menu_items (
  video_id uuid not null references public.videos(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  is_primary boolean not null default true,
  status public.link_status not null default 'pending',
  requested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  primary key (video_id, menu_item_id)
);
create index video_menu_items_restaurant_pending_idx on public.video_menu_items (restaurant_id, created_at) where status = 'pending';
create index video_menu_items_item_idx on public.video_menu_items (menu_item_id) where status = 'approved';
create unique index video_menu_items_one_primary on public.video_menu_items (video_id) where is_primary;

-- Not SECURITY DEFINER on purpose: it must see the caller's role (current_user).
create or replace function public.handle_video_link() returns trigger
language plpgsql set search_path = public as $$
declare
  item_restaurant uuid;
  caller uuid := auth.uid();
  caller_is_privileged boolean := current_user not in ('authenticated', 'anon');
begin
  select restaurant_id into item_restaurant from public.menu_items where id = new.menu_item_id;
  if item_restaurant is null or item_restaurant <> new.restaurant_id then
    raise exception 'menu item does not belong to restaurant' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if not caller_is_privileged then
      if not exists (select 1 from public.videos v where v.id = new.video_id and v.uploader_id = caller)
         and not public.is_restaurant_member(new.restaurant_id, 'manager') then
        raise exception 'Only the uploader or the restaurant can tag this video' using errcode = '42501';
      end if;
      new.requested_by := caller;
      new.reviewed_by := null; new.reviewed_at := null; new.rejection_reason := null;
      -- Auto-approve when the restaurant tags its own item, or has pre-approved this creator.
      if public.is_restaurant_member(new.restaurant_id, 'manager')
         or exists (select 1 from public.creator_permissions p
                    where p.restaurant_id = new.restaurant_id and p.creator_id = caller and p.permission = 'auto_approve_tags') then
        new.status := 'approved';
        new.reviewed_by := caller;
        new.reviewed_at := now();
      else
        new.status := 'pending';
      end if;
    end if;
  else
    if not caller_is_privileged then
      if not public.is_restaurant_member(old.restaurant_id, 'manager') and not public.is_admin() then
        raise exception 'Only the tagged restaurant can review this link' using errcode = '42501';
      end if;
      new.video_id := old.video_id; new.menu_item_id := old.menu_item_id; new.restaurant_id := old.restaurant_id;
      new.requested_by := old.requested_by;
      if new.status is distinct from old.status then
        new.reviewed_by := caller;
        new.reviewed_at := now();
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger video_menu_items_guard before insert or update on public.video_menu_items for each row execute function public.handle_video_link();

-- ---------------------------------------------------------------------------
-- Social graph & engagement
-- ---------------------------------------------------------------------------
create table public.user_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index user_follows_followee_idx on public.user_follows (followee_id);

create table public.restaurant_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);
create index restaurant_follows_restaurant_idx on public.restaurant_follows (restaurant_id);

create table public.video_likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index video_likes_video_idx on public.video_likes (video_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  status public.comment_status not null default 'visible',
  created_at timestamptz not null default now()
);
create index comments_video_idx on public.comments (video_id, created_at desc) where status = 'visible';

create or replace function public.protect_comment_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.status := 'visible';
      if not exists (select 1 from public.videos v where v.id = new.video_id and v.status = 'published' and v.comments_enabled) then
        raise exception 'Comments are not available on this video' using errcode = '42501';
      end if;
    else
      new.status := old.status; new.user_id := old.user_id; new.video_id := old.video_id;
    end if;
  end if;
  return new;
end $$;
create trigger comments_protect before insert or update on public.comments for each row execute function public.protect_comment_columns();

-- Cravings collection: right swipes and the Save button both land here.
create type public.saved_meal_source as enum ('crave_swipe', 'save_button');
create table public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid references public.videos(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  source public.saved_meal_source not null,
  created_at timestamptz not null default now(),
  check (video_id is not null or menu_item_id is not null)
);
create unique index saved_meals_user_video_uniq on public.saved_meals (user_id, video_id) where video_id is not null;
create unique index saved_meals_user_item_uniq on public.saved_meals (user_id, menu_item_id) where video_id is null;
create index saved_meals_user_idx on public.saved_meals (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Denormalised counters
-- ---------------------------------------------------------------------------
create or replace function public.bump_counters() returns trigger
language plpgsql security definer set search_path = public as $$
declare d integer := case when tg_op = 'INSERT' then 1 else -1 end;
        r record;
begin
  r := case when tg_op = 'INSERT' then new else old end;
  if tg_table_name = 'video_likes' then
    update public.videos set like_count = greatest(0, like_count + d) where id = r.video_id;
  elsif tg_table_name = 'saved_meals' then
    if r.video_id is not null then
      update public.videos set save_count = greatest(0, save_count + d) where id = r.video_id;
    end if;
  elsif tg_table_name = 'comments' then
    update public.videos set comment_count = greatest(0, comment_count + d) where id = r.video_id;
  elsif tg_table_name = 'user_follows' then
    update public.profiles set follower_count = greatest(0, follower_count + d) where id = r.followee_id;
    update public.profiles set following_count = greatest(0, following_count + d) where id = r.follower_id;
  elsif tg_table_name = 'restaurant_follows' then
    update public.restaurants set follower_count = greatest(0, follower_count + d) where id = r.restaurant_id;
  end if;
  return null;
end $$;
create trigger video_likes_count after insert or delete on public.video_likes for each row execute function public.bump_counters();
create trigger saved_meals_count after insert or delete on public.saved_meals for each row execute function public.bump_counters();
create trigger comments_count after insert or delete on public.comments for each row execute function public.bump_counters();
create trigger user_follows_count after insert or delete on public.user_follows for each row execute function public.bump_counters();
create trigger restaurant_follows_count after insert or delete on public.restaurant_follows for each row execute function public.bump_counters();
