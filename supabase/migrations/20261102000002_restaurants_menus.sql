-- Restaurants, locations, verification, hours, menus, items and customisations.

create table public.restaurants (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 2 and 100),
  slug               text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  description        text check (char_length(description) <= 1000),
  logo_url           text,
  cover_url          text,
  abn                text check (abn ~ '^[0-9]{11}$'),          -- Australian Business Number
  legal_name         text,
  cuisines           text[] not null default '{}',              -- e.g. {japanese,sushi}
  price_level        smallint not null default 2 check (price_level between 1 and 4),
  status             public.restaurant_status not null default 'draft',
  -- Commission in basis points (1000 = 10%). Only admins may change it (see trigger).
  commission_rate_bps integer not null default 1000 check (commission_rate_bps between 0 and 5000),
  stripe_account_id  text unique,
  payouts_enabled    boolean not null default false,
  accepts_advance_orders boolean not null default false,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index restaurants_status_idx on public.restaurants (status);
create index restaurants_cuisines_idx on public.restaurants using gin (cuisines);
create trigger restaurants_updated_at before update on public.restaurants
  for each row execute function public.set_updated_at();

create table public.restaurant_members (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          public.restaurant_member_role not null default 'staff',
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index restaurant_members_user_idx on public.restaurant_members (user_id);

create or replace function public.is_restaurant_member(
  p_restaurant_id uuid,
  p_roles public.restaurant_member_role[] default array['owner','manager','staff']::public.restaurant_member_role[]
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurant_members
    where restaurant_id = p_restaurant_id and user_id = auth.uid() and role = any (p_roles)
  );
$$;

-- Non-admins cannot change verification status, commission or payout fields.
create or replace function public.protect_restaurant_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or public.request_is_privileged() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.commission_rate_bps := coalesce(
      (select (value #>> '{}')::int from public.platform_settings where key = 'default_commission_bps'), 1000);
    new.stripe_account_id := null;
    new.payouts_enabled := false;
    return new;
  end if;
  if new.commission_rate_bps is distinct from old.commission_rate_bps
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.payouts_enabled is distinct from old.payouts_enabled then
    raise exception 'Only administrators can change commission or payout settings' using errcode = '42501';
  end if;
  -- Owners may only move draft/rejected -> pending_verification.
  if new.status is distinct from old.status
     and not (old.status in ('draft', 'rejected') and new.status = 'pending_verification') then
    raise exception 'Restaurant status can only be changed by an administrator' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger restaurants_protect before insert or update on public.restaurants
  for each row execute function public.protect_restaurant_fields();

create table public.restaurant_locations (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  city_id          uuid not null references public.cities(id),
  label            text,                                     -- e.g. "Fortitude Valley"
  address_line1    text not null,
  address_line2    text,
  suburb           text not null,
  region           text not null,                            -- state, e.g. QLD
  postcode         text not null check (postcode ~ '^[0-9]{4}$'),
  country_code     char(2) not null default 'AU' references public.countries(code),
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  phone            text,
  pickup_enabled   boolean not null default true,
  delivery_enabled boolean not null default false,
  delivery_radius_km numeric(5,2),
  prep_time_minutes smallint not null default 15 check (prep_time_minutes between 1 and 240),
  -- Manual pause switch ("busy, not taking orders right now").
  is_accepting_orders boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index restaurant_locations_restaurant_idx on public.restaurant_locations (restaurant_id);
create index restaurant_locations_city_idx on public.restaurant_locations (city_id);
create index restaurant_locations_latlng_idx on public.restaurant_locations (lat, lng);
create trigger restaurant_locations_updated_at before update on public.restaurant_locations
  for each row execute function public.set_updated_at();

-- day_of_week: 0 = Sunday ... 6 = Saturday, in the city's local timezone.
-- closes_at <= opens_at means the period runs past midnight into the next day.
create table public.location_opening_hours (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.restaurant_locations(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at    time not null,
  closes_at   time not null,
  unique (location_id, day_of_week, opens_at)
);

-- One-off closures (public holidays etc.).
create table public.location_closures (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.restaurant_locations(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null check (ends_at > starts_at),
  reason      text
);

create or replace function public.location_is_open(p_location_id uuid, p_at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_local timestamp;
  v_dow int;
  v_time time;
begin
  select c.timezone into v_tz
  from public.restaurant_locations l join public.cities c on c.id = l.city_id
  where l.id = p_location_id;
  if v_tz is null then return false; end if;

  if exists (select 1 from public.location_closures
             where location_id = p_location_id and p_at >= starts_at and p_at < ends_at) then
    return false;
  end if;

  v_local := p_at at time zone v_tz;
  v_dow := extract(dow from v_local)::int;
  v_time := v_local::time;

  return exists (
    select 1 from public.location_opening_hours h
    where h.location_id = p_location_id and (
      -- same-day period
      (h.day_of_week = v_dow and h.closes_at > h.opens_at and v_time >= h.opens_at and v_time < h.closes_at)
      -- overnight period that started today
      or (h.day_of_week = v_dow and h.closes_at <= h.opens_at and v_time >= h.opens_at)
      -- overnight period that started yesterday
      or (h.day_of_week = (v_dow + 6) % 7 and h.closes_at <= h.opens_at and v_time < h.closes_at)
    )
  );
end $$;

create table public.restaurant_verifications (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  submitted_by   uuid not null references auth.users(id),
  status         public.verification_status not null default 'submitted',
  -- Storage paths in the private "verification-docs" bucket (food licence, ABN evidence, ID).
  document_paths text[] not null default '{}',
  food_business_licence_number text,
  reviewer_id    uuid references auth.users(id),
  reviewer_notes text,
  submitted_at   timestamptz not null default now(),
  decided_at     timestamptz
);
create index restaurant_verifications_restaurant_idx on public.restaurant_verifications (restaurant_id);
create index restaurant_verifications_status_idx on public.restaurant_verifications (status);

-- Third-party certifications (e.g. halal) verified by an admin from evidence.
create table public.restaurant_certifications (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  certification  text not null check (certification in ('halal', 'kosher', 'organic', 'vegan')),
  certifier_name text,
  certificate_ref text,
  evidence_path  text,
  valid_until    date,
  verified_at    timestamptz,
  verified_by    uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  unique (restaurant_id, certification)
);

create table public.menus (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null default 'Menu',
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index menus_restaurant_idx on public.menus (restaurant_id);

create table public.menu_items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  menu_id        uuid references public.menus(id) on delete set null,
  section        text not null default 'Mains',
  name           text not null check (char_length(name) between 1 and 120),
  description    text check (char_length(description) <= 600),
  -- Tax-inclusive price in the restaurant country's currency.
  price_cents    integer not null check (price_cents >= 0 and price_cents <= 100000000),
  currency       char(3) not null default 'AUD',
  gst_applicable boolean not null default true,
  image_url      text,
  cuisine        text,                                  -- e.g. japanese
  category       text,                                  -- e.g. burger, sushi, dessert
  tags           text[] not null default '{}',          -- descriptive attributes: chicken, spicy, grilled
  -- Dietary claims are declared by the restaurant (not inferred). Shown with a disclaimer.
  dietary_tags   text[] not null default '{}' check (dietary_tags <@ array['vegetarian','vegan','gluten_free','dairy_free','halal','nut_free']::text[]),
  allergens      text[] not null default '{}',
  spice_level    smallint check (spice_level between 0 and 4),
  is_available   boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index menu_items_restaurant_idx on public.menu_items (restaurant_id);
create index menu_items_category_idx on public.menu_items (category);
create index menu_items_tags_idx on public.menu_items using gin (tags);
create index menu_items_name_trgm_idx on public.menu_items using gin (name gin_trgm_ops);
create trigger menu_items_updated_at before update on public.menu_items
  for each row execute function public.set_updated_at();

create table public.menu_item_option_groups (
  id           uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name         text not null,                        -- e.g. "Size", "Extras"
  min_select   smallint not null default 0 check (min_select >= 0),
  max_select   smallint not null default 1 check (max_select >= 1),
  sort_order   integer not null default 0,
  check (max_select >= min_select)
);
create index option_groups_item_idx on public.menu_item_option_groups (menu_item_id);

create table public.menu_item_options (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.menu_item_option_groups(id) on delete cascade,
  name              text not null,
  price_delta_cents integer not null default 0 check (price_delta_cents between -100000 and 100000),
  is_available      boolean not null default true,
  sort_order        integer not null default 0
);
create index options_group_idx on public.menu_item_options (group_id);

-- Is a menu item orderable right now (or at p_at for advance orders)?
create or replace function public.menu_item_orderable(p_menu_item_id uuid, p_location_id uuid, p_at timestamptz default now())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.menu_items mi
    join public.restaurants r on r.id = mi.restaurant_id
    join public.restaurant_locations l on l.restaurant_id = r.id and l.id = p_location_id
    where mi.id = p_menu_item_id
      and mi.is_available
      and r.status = 'verified'
      and l.is_accepting_orders
      and l.pickup_enabled
      and public.location_is_open(l.id, p_at)
  );
$$;
