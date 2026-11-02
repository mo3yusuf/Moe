-- Recommendation signals and taste profiles.
-- Data minimisation: events store ids + coarse numbers only. No location, device fingerprint or IP.

create type public.interaction_type as enum (
  'impression', 'watch', 'replay', 'like', 'unlike', 'share', 'comment',
  'save', 'unsave', 'menu_item_click', 'order_click', 'add_to_basket', 'restaurant_click'
);
create type public.swipe_direction as enum ('right', 'left');
create type public.input_method as enum ('gesture', 'button', 'accessibility_action');

-- Append-only interaction log. Partition by month when volume requires it.
create table public.video_interactions (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  video_id       uuid not null references public.videos(id) on delete cascade,
  menu_item_id   uuid references public.menu_items(id) on delete set null,
  event_type     public.interaction_type not null,
  watch_ms       integer check (watch_ms between 0 and 3600000),
  completion_pct smallint check (completion_pct between 0 and 100),
  feed_request_id uuid,                     -- joins back to recommendation_impressions
  client_event_id uuid,                     -- idempotency key from the device
  created_at     timestamptz not null default now(),
  unique (user_id, client_event_id)
);
create index video_interactions_user_time_idx on public.video_interactions (user_id, created_at desc);
create index video_interactions_video_idx on public.video_interactions (video_id, event_type);

create table public.swipe_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  video_id       uuid not null references public.videos(id) on delete cascade,
  menu_item_id   uuid references public.menu_items(id) on delete set null,
  direction      public.swipe_direction not null,
  input_method   public.input_method not null default 'gesture',
  feed_request_id uuid,
  client_event_id uuid,
  created_at     timestamptz not null default now(),
  unique (user_id, client_event_id)
);
create index swipe_events_user_time_idx on public.swipe_events (user_id, created_at desc);
create index swipe_events_user_video_idx on public.swipe_events (user_id, video_id);

create table public.search_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  query      text not null check (char_length(query) <= 100),
  result_count integer,
  created_at timestamptz not null default now()
);
create index search_events_user_time_idx on public.search_events (user_id, created_at desc);

-- Explicit preferences the customer chose. Dietary requirements are ONLY ever set here, by the user.
create table public.user_taste_preferences (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  favourite_cuisines    text[] not null default '{}',
  disliked_cuisines     text[] not null default '{}',
  dietary_requirements  text[] not null default '{}' check (dietary_requirements <@ array['vegetarian','vegan','gluten_free','dairy_free','halal','nut_free']::text[]),
  spice_preference      smallint check (spice_preference between 0 and 4),
  typical_budget_cents  integer check (typical_budget_cents between 0 and 100000),
  preferred_fulfilment  public.fulfilment_type,
  updated_at            timestamptz not null default now()
);
create trigger user_taste_preferences_updated_at before update on public.user_taste_preferences
  for each row execute function public.set_updated_at();

-- Learned affinities, computed server-side from events. feature examples:
--   'cuisine:japanese', 'category:burger', 'tag:chicken', 'restaurant:<uuid>', 'price:2', 'daypart:fri_evening'
create table public.user_feature_affinities (
  user_id     uuid not null references auth.users(id) on delete cascade,
  feature     text not null check (char_length(feature) <= 80),
  score       real not null default 0,
  evidence    integer not null default 0,     -- number of events contributing
  updated_at  timestamptz not null default now(),
  primary key (user_id, feature)
);

-- Optional per-user cache of ranked candidates (written by the ranking service).
create table public.recommendation_scores (
  user_id       uuid not null references auth.users(id) on delete cascade,
  video_id      uuid not null references public.videos(id) on delete cascade,
  score         real not null,
  model_version text not null,
  computed_at   timestamptz not null default now(),
  primary key (user_id, video_id)
);

-- What we showed, where, and why. Used for evaluation (CTR, order conversion) and de-duplication.
create table public.recommendation_impressions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  video_id        uuid not null references public.videos(id) on delete cascade,
  feed_request_id uuid not null,
  position        smallint not null,
  score           real,
  model_version   text not null,
  is_exploration  boolean not null default false,
  reasons         text[] not null default '{}',
  created_at      timestamptz not null default now()
);
create index recommendation_impressions_user_time_idx on public.recommendation_impressions (user_id, created_at desc);
create index recommendation_impressions_request_idx on public.recommendation_impressions (feed_request_id);
