-- =============================================================================
-- CRAVE — Foundation: extensions, enums, markets, profiles, roles, preferences
-- =============================================================================
-- Conventions
--   * Money is stored as integer cents (bigint/integer) with an explicit currency.
--   * All timestamps are timestamptz (UTC). Local business hours use time + IANA tz.
--   * Every table has RLS enabled (policies live in 20261102000007_rls.sql).
--   * Business-critical writes (orders, payments, taste profiles) are performed by
--     the CRAVE API using the service role, never directly by the client.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('customer', 'creator', 'restaurant_owner', 'admin');
create type public.profile_visibility as enum ('public', 'private');
create type public.consent_type as enum ('terms_of_service', 'privacy_policy', 'personalisation', 'precise_location', 'marketing_email', 'push_notifications');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Great-circle distance in km (haversine). Adequate for city-scale MVP queries;
-- move to PostGIS geography + GiST when restaurant counts grow.
create or replace function public.distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 6371.0 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---------------------------------------------------------------------------
-- Markets: cities/regions CRAVE operates in. Brisbane first; multi-city/country ready.
-- ---------------------------------------------------------------------------
create table public.markets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                       -- e.g. 'au-bne'
  city text not null,
  region text not null,                            -- state/province, e.g. 'QLD'
  country_code char(2) not null,                   -- ISO 3166-1 alpha-2
  timezone text not null,                          -- IANA, e.g. 'Australia/Brisbane'
  currency char(3) not null,                       -- ISO 4217, e.g. 'AUD'
  tax_name text not null default 'GST',
  tax_rate_bps integer not null default 1000 check (tax_rate_bps between 0 and 5000),
  prices_include_tax boolean not null default true,
  center_lat double precision not null,
  center_lng double precision not null,
  service_radius_km numeric(6,2) not null default 25,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username extensions.citext unique check (username ~ '^[a-zA-Z0-9_.]{3,30}$'),
  display_name text check (char_length(display_name) <= 60),
  avatar_url text,
  bio text check (char_length(bio) <= 300),
  market_id uuid references public.markets(id),
  visibility public.profile_visibility not null default 'public',
  -- Customer controls for personalisation (Privacy settings screen).
  personalisation_enabled boolean not null default true,
  show_activity_to_restaurants boolean not null default false,
  date_of_birth_confirmed_16_plus boolean not null default false,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Role helpers. SECURITY DEFINER so they can be used inside RLS policies
-- without recursive policy evaluation. search_path pinned for safety.
create or replace function public.has_role(check_role public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = check_role);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Explicit food preferences. Never inferred from behaviour.
-- ---------------------------------------------------------------------------
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favourite_cuisines text[] not null default '{}',
  dietary_requirements text[] not null default '{}',   -- hard filters, e.g. {'halal_certified'}
  dietary_preferences text[] not null default '{}',    -- soft boosts, e.g. {'vegetarian'}
  avoid_tags text[] not null default '{}',             -- ingredients the user asked to hide
  max_spice_level smallint check (max_spice_level between 0 and 4),
  budget_per_meal_cents integer check (budget_per_meal_cents > 0),
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (cardinality(favourite_cuisines) <= 20 and cardinality(avoid_tags) <= 30)
);
create trigger user_preferences_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privacy consent records (append-only audit trail).
-- ---------------------------------------------------------------------------
create table public.privacy_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent public.consent_type not null,
  granted boolean not null,
  policy_version text not null,
  source text not null default 'app' check (source in ('app', 'web', 'admin')),
  created_at timestamptz not null default now()
);
create index privacy_consents_user_idx on public.privacy_consents (user_id, consent, created_at desc);

-- Latest consent state per user/consent type.
create view public.current_privacy_consents with (security_invoker = true) as
  select distinct on (user_id, consent) user_id, consent, granted, policy_version, created_at
  from public.privacy_consents
  order by user_id, consent, created_at desc;

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile + customer role + empty preferences.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  default_market uuid;
begin
  select id into default_market from public.markets where code = 'au-bne';
  insert into public.profiles (id, display_name, market_id)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)), default_market);
  insert into public.user_roles (user_id, role) values (new.id, 'customer');
  insert into public.user_preferences (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may not edit server-managed profile columns.
create or replace function public.protect_profile_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.follower_count := old.follower_count;
    new.following_count := old.following_count;
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles for each row execute function public.protect_profile_columns();
