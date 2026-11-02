-- =============================================================================
-- CRAVE — Restaurants, locations, verification, hours, menus, customisations
-- =============================================================================

create type public.restaurant_status as enum ('draft', 'pending_verification', 'active', 'suspended');
create type public.restaurant_member_role as enum ('owner', 'manager', 'staff');
create type public.verification_status as enum ('submitted', 'needs_info', 'approved', 'rejected');

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text check (char_length(description) <= 500),
  market_id uuid not null references public.markets(id),
  status public.restaurant_status not null default 'draft',
  cuisines text[] not null default '{}',
  price_level smallint check (price_level between 1 and 4),
  logo_url text,
  cover_url text,
  -- Operational toggles controlled by the restaurant.
  accepting_orders boolean not null default false,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default false,       -- requires a delivery integration (Phase 8)
  accepts_advance_orders boolean not null default false,
  avg_prep_minutes smallint not null default 15 check (avg_prep_minutes between 1 and 180),
  -- Verified dietary claims (e.g. halal certificate checked by CRAVE staff).
  verified_dietary text[] not null default '{}',
  rating_avg numeric(3,2),
  rating_count integer not null default 0,
  follower_count integer not null default 0,
  -- Payments (Stripe Connect). Set only by the API after onboarding.
  stripe_account_id text unique,
  payouts_enabled boolean not null default false,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index restaurants_market_status_idx on public.restaurants (market_id, status);
create index restaurants_cuisines_idx on public.restaurants using gin (cuisines);
create trigger restaurants_updated_at before update on public.restaurants for each row execute function public.set_updated_at();

create table public.restaurant_members (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.restaurant_member_role not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index restaurant_members_user_idx on public.restaurant_members (user_id);

create or replace function public.is_restaurant_member(rid uuid, min_role public.restaurant_member_role default 'staff')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = rid and m.user_id = auth.uid()
      and case min_role
            when 'owner' then m.role = 'owner'
            when 'manager' then m.role in ('owner', 'manager')
            else true
          end
  );
$$;

-- Creator of a restaurant automatically becomes its owner.
create or replace function public.handle_new_restaurant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.restaurant_members (restaurant_id, user_id, role) values (new.id, new.created_by, 'owner')
      on conflict do nothing;
    insert into public.user_roles (user_id, role) values (new.created_by, 'restaurant_owner') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger on_restaurant_created after insert on public.restaurants for each row execute function public.handle_new_restaurant();

-- Restaurants cannot self-activate, verify, or change payment fields.
create or replace function public.protect_restaurant_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'draft';
      new.created_by := auth.uid();
      new.stripe_account_id := null;
      new.payouts_enabled := false;
      new.verified_dietary := '{}';
      new.verified_at := null;
      new.is_demo := false;
      new.rating_avg := null;
      new.rating_count := 0;
      new.follower_count := 0;
      new.accepting_orders := false;
      new.delivery_enabled := false;
    else
      if new.status is distinct from old.status
         and not (old.status = 'draft' and new.status = 'pending_verification') then
        raise exception 'Only CRAVE administrators can change restaurant status' using errcode = '42501';
      end if;
      new.stripe_account_id := old.stripe_account_id;
      new.payouts_enabled := old.payouts_enabled;
      new.verified_dietary := old.verified_dietary;
      new.verified_at := old.verified_at;
      new.is_demo := old.is_demo;
      new.rating_avg := old.rating_avg;
      new.rating_count := old.rating_count;
      new.follower_count := old.follower_count;
      new.created_by := old.created_by;
      new.market_id := old.market_id;
      -- Delivery stays off until a delivery provider integration is enabled.
      new.delivery_enabled := old.delivery_enabled;
    end if;
  end if;
  return new;
end $$;
create trigger restaurants_protect before insert or update on public.restaurants for each row execute function public.protect_restaurant_columns();

create table public.restaurant_locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label text not null default 'Main',
  unit text,
  street_line text not null,
  suburb text not null,
  state text not null check (state in ('QLD', 'NSW', 'VIC', 'ACT', 'TAS', 'SA', 'WA', 'NT') or country_code <> 'AU'),
  postcode text not null check (postcode ~ '^[0-9]{4}$' or country_code <> 'AU'),
  country_code char(2) not null default 'AU',
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  timezone text not null default 'Australia/Brisbane',
  phone text,
  pickup_instructions text check (char_length(pickup_instructions) <= 300),
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);
create index restaurant_locations_restaurant_idx on public.restaurant_locations (restaurant_id);
-- Bounding-box prefilter for "near me" queries (see public.distance_km).
create index restaurant_locations_latlng_idx on public.restaurant_locations (lat, lng);
create unique index restaurant_locations_one_primary on public.restaurant_locations (restaurant_id) where is_primary;

create table public.restaurant_verifications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  legal_business_name text not null,
  abn text not null check (abn ~ '^[0-9]{11}$'),
  gst_registered boolean not null,
  business_contact_name text not null,
  business_contact_email text not null,
  business_contact_phone text not null,
  food_business_licence_number text,              -- e.g. Brisbane City Council food business licence
  licensing_council text,
  halal_certificate_path text,                    -- storage path in private bucket, optional
  document_paths text[] not null default '{}',     -- private storage paths
  status public.verification_status not null default 'submitted',
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewer_notes text,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index restaurant_verifications_restaurant_idx on public.restaurant_verifications (restaurant_id, submitted_at desc);
create index restaurant_verifications_status_idx on public.restaurant_verifications (status) where status in ('submitted', 'needs_info');

create or replace function public.protect_verification_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'submitted';
      new.reviewer_id := null;
      new.reviewer_notes := null;
      new.reviewed_at := null;
      new.submitted_by := auth.uid();
    else
      raise exception 'Verification submissions cannot be edited; submit a new one' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger restaurant_verifications_protect before insert or update on public.restaurant_verifications
  for each row execute function public.protect_verification_columns();

-- Submitting a verification moves a draft restaurant into the review queue.
create or replace function public.handle_verification_submitted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.restaurants set status = 'pending_verification'
    where id = new.restaurant_id and status = 'draft';
  return new;
end $$;
create trigger on_verification_submitted after insert on public.restaurant_verifications
  for each row execute function public.handle_verification_submitted();

create table public.opening_hours (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.restaurant_locations(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),  -- 0 = Sunday
  opens_at time not null,
  closes_at time not null,                                            -- <= opens_at means past midnight
  check (opens_at <> closes_at)
);
create index opening_hours_location_idx on public.opening_hours (location_id, day_of_week);

create table public.special_closures (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.restaurant_locations(id) on delete cascade,
  closed_on date not null,
  reason text,
  unique (location_id, closed_on)
);

-- ---------------------------------------------------------------------------
-- Menus
-- ---------------------------------------------------------------------------
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null default 'Menu',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index menus_restaurant_idx on public.menus (restaurant_id);

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0
);
create index menu_categories_menu_idx on public.menu_categories (menu_id, sort_order);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  description text check (char_length(description) <= 500),
  price_cents integer not null check (price_cents >= 0 and price_cents <= 100000),
  currency char(3) not null default 'AUD',
  is_available boolean not null default true,
  image_url text,
  cuisine text,                                   -- primary cuisine for recommendations
  food_category text,                             -- e.g. 'burgers', 'sushi', 'desserts'
  tags text[] not null default '{}',              -- dish/ingredient tags, lower-case
  dietary_attributes text[] not null default '{}',-- restaurant-declared, e.g. {'vegetarian'}
  allergens text[] not null default '{}',         -- restaurant-declared allergen info
  spice_level smallint check (spice_level between 0 and 4),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_items_restaurant_idx on public.menu_items (restaurant_id) where archived_at is null;
create index menu_items_category_idx on public.menu_items (category_id, sort_order);
create index menu_items_tags_idx on public.menu_items using gin (tags);
create trigger menu_items_updated_at before update on public.menu_items for each row execute function public.set_updated_at();

-- Customisations: sizes, extras, removals.
create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,                      -- e.g. 'Size', 'Extras'
  min_select smallint not null default 0 check (min_select >= 0),
  max_select smallint not null default 1 check (max_select >= 1),
  sort_order integer not null default 0,
  check (min_select <= max_select)
);
create index modifier_groups_item_idx on public.modifier_groups (menu_item_id, sort_order);

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.modifier_groups(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  price_delta_cents integer not null default 0 check (price_delta_cents between -10000 and 10000),
  is_available boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0
);
create index modifier_options_group_idx on public.modifier_options (group_id, sort_order);

-- Menu-item photos (restaurants without videos still get a visual menu).
create table public.menu_item_media (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Keep restaurant_id denormalised columns consistent with their parents.
create or replace function public.enforce_restaurant_consistency() returns trigger
language plpgsql as $$
declare parent_restaurant uuid;
begin
  if tg_table_name = 'menu_categories' then
    select restaurant_id into parent_restaurant from public.menus where id = new.menu_id;
  elsif tg_table_name = 'menu_items' then
    if new.category_id is null then return new; end if;
    select restaurant_id into parent_restaurant from public.menu_categories where id = new.category_id;
  elsif tg_table_name = 'modifier_groups' then
    select restaurant_id into parent_restaurant from public.menu_items where id = new.menu_item_id;
  elsif tg_table_name = 'modifier_options' then
    select restaurant_id into parent_restaurant from public.modifier_groups where id = new.group_id;
  elsif tg_table_name = 'menu_item_media' then
    select restaurant_id into parent_restaurant from public.menu_items where id = new.menu_item_id;
  end if;
  if parent_restaurant is distinct from new.restaurant_id then
    raise exception 'restaurant_id does not match parent record' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger menu_categories_consistency before insert or update on public.menu_categories for each row execute function public.enforce_restaurant_consistency();
create trigger menu_items_consistency before insert or update on public.menu_items for each row execute function public.enforce_restaurant_consistency();
create trigger modifier_groups_consistency before insert or update on public.modifier_groups for each row execute function public.enforce_restaurant_consistency();
create trigger modifier_options_consistency before insert or update on public.modifier_options for each row execute function public.enforce_restaurant_consistency();
create trigger menu_item_media_consistency before insert or update on public.menu_item_media for each row execute function public.enforce_restaurant_consistency();

-- Staff (non-managers) may only toggle availability, not prices or content.
create or replace function public.protect_menu_item_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin()
     and not public.is_restaurant_member(old.restaurant_id, 'manager') then
    if (to_jsonb(new) - 'is_available' - 'updated_at') is distinct from (to_jsonb(old) - 'is_available' - 'updated_at') then
      raise exception 'Staff can only change item availability' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger menu_items_protect before update on public.menu_items for each row execute function public.protect_menu_item_columns();
