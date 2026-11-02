-- CRAVE core schema: geography, profiles, roles and shared helpers.
-- Money is always stored as integer cents. Timestamps are timestamptz (UTC).

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('customer', 'creator', 'restaurant_staff', 'admin');
create type public.restaurant_member_role as enum ('owner', 'manager', 'staff');
create type public.restaurant_status as enum ('draft', 'pending_verification', 'verified', 'suspended', 'rejected');
create type public.verification_status as enum ('submitted', 'in_review', 'approved', 'rejected', 'more_info_required');
create type public.fulfilment_type as enum ('pickup', 'delivery');

-- ---------------------------------------------------------------------------
-- Geography (multi-city / multi-country ready; launch market is Brisbane)
-- ---------------------------------------------------------------------------
create table public.countries (
  code            char(2) primary key,               -- ISO 3166-1 alpha-2
  name            text not null,
  currency        char(3) not null,                  -- ISO 4217
  tax_name        text not null default 'GST',
  tax_rate_bps    integer not null check (tax_rate_bps between 0 and 5000), -- 1000 = 10%
  prices_include_tax boolean not null default true    -- AU: displayed prices must be tax-inclusive
);

create table public.cities (
  id          uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code),
  name        text not null,
  region      text not null,                          -- state / territory, e.g. QLD
  timezone    text not null,                          -- IANA, e.g. Australia/Brisbane
  is_active   boolean not null default false,
  centre_lat  double precision not null,
  centre_lng  double precision not null,
  created_at  timestamptz not null default now(),
  unique (country_code, region, name)
);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users). Only non-sensitive, display-level data.
-- Email lives in auth.users and is never exposed to restaurants or creators.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null default '' check (char_length(display_name) <= 60),
  username        text unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  avatar_url      text,
  bio             text check (char_length(bio) <= 300),
  home_city_id    uuid references public.cities(id),
  onboarding_completed_at timestamptz,
  -- Recommendation signals created before this moment are ignored (Reset My Taste Profile).
  taste_reset_at  timestamptz,
  deletion_requested_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- True for the service role and direct database sessions (migrations, seeds, workers); false for
-- requests made with an end-user (authenticated) or anon JWT. Claims are set by the API gateway
-- from a verified JWT, so clients cannot forge them.
create or replace function public.request_is_privileged() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'postgres')
         not in ('authenticated', 'anon');
$$;

create or replace function public.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin');
$$;

-- Great-circle distance in km. (Swap for PostGIS geography when scale requires it.)
create or replace function public.haversine_km(lat1 double precision, lng1 double precision,
                                               lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- New auth user => profile + customer role.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 60), ''));
  insert into public.user_roles (user_id, role) values (new.id, 'customer');
  -- Consent choices made on the sign-up screen (raw_user_meta_data.consents) are recorded here,
  -- server-side, so they are captured even if email confirmation delays the first session.
  -- Unknown consent types are ignored; values must be JSON booleans.
  insert into public.privacy_consents (user_id, consent_type, granted, policy_version, source)
  select new.id, c.key, (c.value)::text::boolean, coalesce(new.raw_user_meta_data ->> 'policy_version', 'unknown'), 'onboarding'
  from jsonb_each(coalesce(new.raw_user_meta_data -> 'consents', '{}'::jsonb)) c
  where c.key in ('personalisation', 'precise_location', 'marketing_email', 'marketing_push', 'analytics')
    and jsonb_typeof(c.value) = 'boolean';
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Platform-wide configurable settings (commission default, ranking weights, fees).
create table public.platform_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);
create trigger platform_settings_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();

-- Append-only audit trail for privileged/admin actions.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
