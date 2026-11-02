-- =============================================================================
-- CRAVE — Interaction signals, taste profiles, recommendation config & logs
-- =============================================================================
-- Privacy by design:
--   * Events store ids + timings only. No location, device ids or free text
--     (except a short, truncated search query).
--   * Raw events are retained for 180 days (see purge_old_interaction_events),
--     long-term learning lives in aggregated taste profiles.
--   * "Reset My Taste Profile" deletes all of the above for the user.

create type public.interaction_type as enum (
  'impression', 'watch', 'crave_swipe', 'not_for_me_swipe', 'like', 'unlike', 'save_meal', 'unsave_meal',
  'share', 'comment', 'menu_item_click', 'add_to_basket', 'search', 'follow_restaurant', 'follow_creator',
  'order_completed'
);
create type public.swipe_direction as enum ('right', 'left');

-- Append-only interaction log ("video interactions").
create table public.video_interactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id uuid not null,
  event_type public.interaction_type not null,
  video_id uuid references public.videos(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  watch_signal text check (watch_signal in ('quick_skip', 'partial_view', 'long_view', 'completed_view')),
  watched_ms integer check (watched_ms >= 0),
  duration_ms integer check (duration_ms >= 0),
  loops smallint check (loops >= 0),
  feed_position integer,
  feed_session_id uuid,
  search_query text check (char_length(search_query) <= 80),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);
create index video_interactions_user_time_idx on public.video_interactions (user_id, occurred_at desc);
create index video_interactions_video_time_idx on public.video_interactions (video_id, occurred_at desc) where video_id is not null;

create table public.swipe_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  direction public.swipe_direction not null,
  feed_session_id uuid,
  created_at timestamptz not null default now()
);
create index swipe_events_user_idx on public.swipe_events (user_id, created_at desc);
create index swipe_events_video_idx on public.swipe_events (video_id, direction);

-- Aggregated taste profile (see packages/core/src/recommendation/types.ts → TasteProfile).
create table public.user_taste_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null,
  config_version text not null,
  signal_count integer not null default 0,
  -- Orders before this instant are ignored when rebuilding (Reset My Taste Profile).
  learning_since timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Versioned, admin-editable weights. Exactly one active row.
create table public.recommendation_configs (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  config jsonb not null,
  is_active boolean not null default false,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index recommendation_configs_one_active on public.recommendation_configs (is_active) where is_active;

-- What we showed, with which score and why (evaluation + "why am I seeing this").
create table public.recommendation_impressions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  feed_session_id uuid not null,
  feed_kind text not null check (feed_kind in ('for_you', 'following', 'nearby', 'trending')),
  position integer not null,
  score real not null,
  reasons text[] not null default '{}',
  exploration boolean not null default false,
  config_version text not null,
  served_at timestamptz not null default now()
);
create index recommendation_impressions_user_idx on public.recommendation_impressions (user_id, served_at desc);
create index recommendation_impressions_config_idx on public.recommendation_impressions (config_version, served_at desc);

-- Optional per-user score cache (filled by a background job for heavy users).
create table public.recommendation_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  score real not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

-- Trending per market, recomputed periodically (refresh_trending_scores()).
create table public.video_trending_scores (
  video_id uuid primary key references public.videos(id) on delete cascade,
  market_id uuid references public.markets(id) on delete cascade,
  score real not null check (score between 0 and 1),
  computed_at timestamptz not null default now()
);
create index video_trending_scores_market_idx on public.video_trending_scores (market_id, score desc);

-- Trending = weighted engagement over the last 7 days, normalised 0..1 per market.
create or replace function public.refresh_trending_scores() returns void
language sql security definer set search_path = public as $$
  with engagement as (
    select v.id as video_id, v.market_id,
      coalesce(sum(case i.event_type
        when 'crave_swipe' then 5 when 'order_completed' then 8 when 'save_meal' then 3 when 'like' then 2
        when 'share' then 2 when 'menu_item_click' then 2 when 'add_to_basket' then 3
        when 'watch' then case i.watch_signal when 'completed_view' then 1 when 'long_view' then 0.6 else 0 end
        when 'not_for_me_swipe' then -2 else 0 end), 0) as raw
    from public.videos v
    left join public.video_interactions i on i.video_id = v.id and i.occurred_at > now() - interval '7 days'
    where v.status = 'published'
    group by v.id, v.market_id
  ), normalised as (
    select video_id, market_id,
      case when max(raw) over (partition by market_id) <= 0 then 0
           else greatest(raw, 0) / max(raw) over (partition by market_id) end as score
    from engagement
  )
  insert into public.video_trending_scores (video_id, market_id, score, computed_at)
  select video_id, market_id, score, now() from normalised
  on conflict (video_id) do update set score = excluded.score, market_id = excluded.market_id, computed_at = excluded.computed_at;
$$;

-- Data retention for raw signals.
create or replace function public.purge_old_interaction_events(retain interval default interval '180 days') returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  delete from public.video_interactions where occurred_at < now() - retain;
  get diagnostics n = row_count;
  delete from public.recommendation_impressions where served_at < now() - retain;
  delete from public.swipe_events where created_at < now() - retain;
  return n;
end $$;

-- "Reset My Taste Profile": deletes learned signals for the CALLING user only.
-- Saved meals (Cravings), orders and explicit preferences are kept, but past
-- orders will no longer influence recommendations (learning_since = now()).
create or replace function public.reset_my_taste_profile() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  delete from public.video_interactions where user_id = uid;
  delete from public.swipe_events where user_id = uid;
  delete from public.recommendation_impressions where user_id = uid;
  delete from public.recommendation_scores where user_id = uid;
  insert into public.user_taste_profiles (user_id, profile, config_version, signal_count, learning_since, updated_at)
    values (uid, '{}'::jsonb, 'reset', 0, now(), now())
    on conflict (user_id) do update set profile = '{}'::jsonb, config_version = 'reset', signal_count = 0,
      learning_since = now(), updated_at = now();
end $$;
