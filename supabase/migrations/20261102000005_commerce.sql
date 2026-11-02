-- =============================================================================
-- CRAVE — Baskets, orders, payments, refunds, payouts, commission, attribution
-- =============================================================================
-- Financial integrity rules
--   * Clients never write orders, payments or ledger rows (no INSERT/UPDATE policies).
--   * The API computes totals from current DB prices, creates the Stripe
--     PaymentIntent, and only a verified Stripe webhook moves an order to 'placed'.
--   * Every money movement is recorded in ledger_entries for reconciliation.

create type public.fulfilment_type as enum ('pickup', 'delivery');
create type public.basket_status as enum ('active', 'converted', 'abandoned');
create type public.order_status as enum (
  'pending_payment', 'placed', 'accepted', 'preparing', 'ready_for_pickup', 'completed', 'rejected', 'cancelled', 'payment_failed'
);
create type public.order_actor as enum ('customer', 'restaurant', 'admin', 'system');
create type public.payment_status as enum ('requires_payment', 'processing', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded');
create type public.refund_status as enum ('pending', 'succeeded', 'failed', 'canceled');
create type public.ledger_entry_type as enum (
  'customer_charge', 'platform_commission', 'service_fee', 'restaurant_earnings', 'refund', 'commission_reversal',
  'payout', 'dispute', 'dispute_reversal', 'processing_fee'
);

-- ---------------------------------------------------------------------------
-- Platform settings & commission agreements (admin managed)
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.commission_agreements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  commission_bps integer not null check (commission_bps between 0 and 5000),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index commission_agreements_restaurant_idx on public.commission_agreements (restaurant_id, effective_from desc);

-- Effective commission for a restaurant at a point in time; falls back to platform default.
create or replace function public.effective_commission_bps(rid uuid, at timestamptz default now()) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select commission_bps from public.commission_agreements
      where restaurant_id = rid and effective_from <= at and (effective_to is null or effective_to > at)
      order by effective_from desc limit 1),
    (select (value ->> 'bps')::integer from public.platform_settings where key = 'default_commission'),
    1000
  );
$$;

-- ---------------------------------------------------------------------------
-- Customer addresses (for delivery, when enabled)
-- ---------------------------------------------------------------------------
create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  unit text,
  street_line text not null,
  suburb text not null,
  state text not null,
  postcode text not null,
  country_code char(2) not null default 'AU',
  lat double precision,
  lng double precision,
  delivery_instructions text check (char_length(delivery_instructions) <= 200),
  created_at timestamptz not null default now(),
  check (country_code <> 'AU' or (postcode ~ '^[0-9]{4}$' and state in ('QLD','NSW','VIC','ACT','TAS','SA','WA','NT')))
);
create index customer_addresses_user_idx on public.customer_addresses (user_id);

-- ---------------------------------------------------------------------------
-- Baskets (one active basket per customer; single restaurant per basket)
-- ---------------------------------------------------------------------------
create table public.baskets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  location_id uuid not null references public.restaurant_locations(id) on delete cascade,
  fulfilment public.fulfilment_type not null default 'pickup',
  status public.basket_status not null default 'active',
  source_video_id uuid references public.videos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index baskets_one_active_per_user on public.baskets (user_id) where status = 'active';
create trigger baskets_updated_at before update on public.baskets for each row execute function public.set_updated_at();

create table public.basket_items (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  quantity smallint not null check (quantity between 1 and 50),
  selected_option_ids uuid[] not null default '{}',
  notes text check (char_length(notes) <= 200),
  source_video_id uuid references public.videos(id) on delete set null,
  created_at timestamptz not null default now()
);
create index basket_items_basket_idx on public.basket_items (basket_id);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create sequence public.order_number_seq start 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('CR-' || nextval('public.order_number_seq')::text),
  -- Nullable so orders survive account deletion (tax record keeping), anonymised.
  customer_id uuid references auth.users(id) on delete set null,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  location_id uuid not null references public.restaurant_locations(id) on delete restrict,
  market_id uuid not null references public.markets(id),
  fulfilment public.fulfilment_type not null default 'pickup',
  status public.order_status not null default 'pending_payment',
  currency char(3) not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  service_fee_cents integer not null default 0 check (service_fee_cents >= 0),
  small_order_fee_cents integer not null default 0 check (small_order_fee_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  gst_included_cents integer not null check (gst_included_cents >= 0),
  commission_bps integer not null check (commission_bps between 0 and 5000),
  commission_cents integer not null check (commission_cents >= 0),
  restaurant_net_cents integer not null,
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  pickup_name text not null check (char_length(pickup_name) between 1 and 40),
  customer_note text check (char_length(customer_note) <= 200),
  delivery_address_id uuid references public.customer_addresses(id) on delete set null,
  scheduled_for timestamptz,                -- advance orders
  estimated_ready_at timestamptz,
  source_video_id uuid references public.videos(id) on delete set null,
  attributed_creator_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  placed_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, idempotency_key),
  check (total_cents = subtotal_cents + service_fee_cents + small_order_fee_cents + delivery_fee_cents),
  check (refunded_cents <= total_cents),
  check (fulfilment = 'pickup' or delivery_address_id is not null)
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_restaurant_status_idx on public.orders (restaurant_id, status, created_at desc);
create index orders_restaurant_created_idx on public.orders (restaurant_id, created_at desc);
create index orders_source_video_idx on public.orders (source_video_id) where source_video_id is not null;
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,                     -- snapshot at time of order
  unit_price_cents integer not null check (unit_price_cents >= 0),
  unit_total_cents integer not null check (unit_total_cents >= 0),
  quantity smallint not null check (quantity between 1 and 50),
  line_total_cents integer not null check (line_total_cents >= 0),
  notes text,
  check (line_total_cents = unit_total_cents * quantity)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_menu_item_idx on public.order_items (menu_item_id);

create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  modifier_option_id uuid references public.modifier_options(id) on delete set null,
  group_name text not null,
  option_name text not null,
  price_delta_cents integer not null
);
create index order_item_options_item_idx on public.order_item_options (order_item_id);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_kind public.order_actor not null,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

-- Defence in depth: the DB refuses invalid status jumps even from the service role.
-- Mirrors packages/core/src/orders.ts (actor checks are done in the API).
create or replace function public.order_transition_allowed(from_s public.order_status, to_s public.order_status) returns boolean
language sql immutable as $$
  select (from_s, to_s) in (
    ('pending_payment'::public.order_status, 'placed'::public.order_status),
    ('pending_payment', 'payment_failed'), ('pending_payment', 'cancelled'),
    ('placed', 'accepted'), ('placed', 'rejected'), ('placed', 'cancelled'),
    ('accepted', 'preparing'), ('accepted', 'ready_for_pickup'), ('accepted', 'cancelled'),
    ('preparing', 'ready_for_pickup'), ('preparing', 'cancelled'),
    ('ready_for_pickup', 'completed')
  );
$$;

create or replace function public.guard_order_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not public.order_transition_allowed(old.status, new.status) then
      raise exception 'Invalid order status transition % -> %', old.status, new.status using errcode = '23514';
    end if;
    case new.status
      when 'placed' then new.placed_at := coalesce(new.placed_at, now());
      when 'accepted' then new.accepted_at := coalesce(new.accepted_at, now());
      when 'ready_for_pickup' then new.ready_at := coalesce(new.ready_at, now());
      when 'completed' then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelled', 'rejected' then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;
  -- Financial columns are immutable once created.
  if new.subtotal_cents <> old.subtotal_cents or new.total_cents <> old.total_cents
     or new.commission_cents <> old.commission_cents or new.commission_bps <> old.commission_bps
     or new.restaurant_id <> old.restaurant_id then
    raise exception 'Order amounts are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger orders_guard_status before update on public.orders for each row execute function public.guard_order_status();

-- ---------------------------------------------------------------------------
-- Payments (Stripe), refunds, disputes, webhooks
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null default 'stripe',
  provider_payment_intent_id text unique,
  provider_charge_id text,
  status public.payment_status not null default 'requires_payment',
  amount_cents integer not null check (amount_cents >= 0),
  currency char(3) not null,
  application_fee_cents integer not null default 0,   -- CRAVE's share via Stripe Connect
  destination_account_id text,                         -- restaurant's connected account
  is_test_mode boolean not null default true,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null check (reason in ('restaurant_rejected', 'customer_cancelled', 'item_unavailable', 'quality_issue', 'duplicate', 'fraud', 'other')),
  status public.refund_status not null default 'pending',
  provider_refund_id text unique,
  refund_application_fee boolean not null default true,
  requested_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_order_idx on public.refunds (order_id);
create trigger refunds_updated_at before update on public.refunds for each row execute function public.set_updated_at();

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  provider_dispute_id text not null unique,
  status text not null,
  reason text,
  amount_cents integer not null,
  evidence_due_by timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every webhook is stored once (idempotency + audit). Payload trimmed to what we need.
create table public.payment_webhook_events (
  provider_event_id text primary key,
  provider text not null default 'stripe',
  event_type text not null,
  livemode boolean not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create table public.restaurant_payouts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  provider_payout_id text unique,
  amount_cents integer not null,
  currency char(3) not null,
  status text not null,
  arrival_date date,
  created_at timestamptz not null default now()
);
create index restaurant_payouts_restaurant_idx on public.restaurant_payouts (restaurant_id, created_at desc);

-- Signed ledger: positive = money owed to the party, negative = money owed by it.
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  order_id uuid references public.orders(id) on delete restrict,
  restaurant_id uuid references public.restaurants(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  refund_id uuid references public.refunds(id) on delete restrict,
  party text not null check (party in ('platform', 'restaurant', 'customer', 'creator', 'provider')),
  entry_type public.ledger_entry_type not null,
  amount_cents integer not null,
  currency char(3) not null,
  source_event_id text,                 -- provider event that caused this entry
  created_at timestamptz not null default now(),
  unique (source_event_id, entry_type, party)
);
create index ledger_entries_restaurant_idx on public.ledger_entries (restaurant_id, created_at desc);
create index ledger_entries_order_idx on public.ledger_entries (order_id);

-- ---------------------------------------------------------------------------
-- Creator attribution & (future) commissions
-- ---------------------------------------------------------------------------
create table public.creator_attributions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  attribution_model text not null default 'video_order_button',
  attributed_subtotal_cents integer not null,
  created_at timestamptz not null default now()
);
create index creator_attributions_creator_idx on public.creator_attributions (creator_id, created_at desc);
create index creator_attributions_restaurant_idx on public.creator_attributions (restaurant_id, created_at desc);

create table public.creator_commissions (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null unique references public.creator_attributions(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  rate_bps integer not null check (rate_bps between 0 and 5000),
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'void')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Delivery module (DISABLED until a provider is integrated — Phase 8)
-- ---------------------------------------------------------------------------
create table public.delivery_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- e.g. 'uber_direct', 'doordash_drive'
  name text not null,
  is_enabled boolean not null default false,
  supported_market_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  provider_id uuid not null references public.delivery_providers(id),
  external_delivery_id text unique,
  status text not null default 'requested',
  quoted_fee_cents integer,
  tracking_url text,                    -- only ever a real provider URL; never simulated
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reporting views (security_invoker → callers only see rows RLS allows)
-- ---------------------------------------------------------------------------
create view public.restaurant_daily_sales with (security_invoker = true) as
  select o.restaurant_id,
         (o.placed_at at time zone m.timezone)::date as sales_date,
         count(*) as order_count,
         sum(o.subtotal_cents) as gross_food_cents,
         sum(o.commission_cents) as commission_cents,
         sum(o.refunded_cents) as refunded_cents,
         sum(o.restaurant_net_cents) as net_cents
  from public.orders o
  join public.markets m on m.id = o.market_id
  where o.status in ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'completed')
  group by o.restaurant_id, sales_date, m.timezone;

create view public.video_sales_performance with (security_invoker = true) as
  select o.source_video_id as video_id,
         o.restaurant_id,
         count(*) as order_count,
         sum(o.subtotal_cents) as attributed_subtotal_cents
  from public.orders o
  where o.source_video_id is not null and o.status in ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'completed')
  group by o.source_video_id, o.restaurant_id;
