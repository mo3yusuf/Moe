-- Baskets, orders, payments, refunds, payouts and creator attribution.
-- All money columns are integer cents. Orders/payments are written ONLY by the backend (service role):
-- clients never submit prices or totals.

create type public.order_status as enum (
  'pending_payment', 'placed', 'accepted', 'preparing', 'ready', 'completed',
  'rejected', 'cancelled', 'payment_failed'
);
create type public.payment_status as enum ('requires_payment', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');
create type public.refund_status as enum ('requested', 'pending', 'succeeded', 'failed', 'rejected');

create table public.baskets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  location_id   uuid not null references public.restaurant_locations(id) on delete cascade,
  fulfilment    public.fulfilment_type not null default 'pickup',
  scheduled_for timestamptz,              -- null = ASAP
  status        text not null default 'active' check (status in ('active', 'converted', 'abandoned')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- One active basket per user (single-restaurant baskets, like most food apps).
create unique index baskets_one_active_idx on public.baskets (user_id) where status = 'active';
create trigger baskets_updated_at before update on public.baskets
  for each row execute function public.set_updated_at();

create table public.basket_items (
  id              uuid primary key default gen_random_uuid(),
  basket_id       uuid not null references public.baskets(id) on delete cascade,
  menu_item_id    uuid not null references public.menu_items(id) on delete cascade,
  quantity        smallint not null check (quantity between 1 and 50),
  option_ids      uuid[] not null default '{}',
  notes           text check (char_length(notes) <= 200),
  source_video_id uuid references public.videos(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index basket_items_basket_idx on public.basket_items (basket_id);

create sequence public.order_number_seq start 1000;

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text not null unique default ('CR-' || nextval('public.order_number_seq')),
  user_id            uuid references auth.users(id) on delete set null,   -- kept for financial records
  restaurant_id      uuid not null references public.restaurants(id),
  location_id        uuid not null references public.restaurant_locations(id),
  status             public.order_status not null default 'pending_payment',
  fulfilment         public.fulfilment_type not null default 'pickup',
  scheduled_for      timestamptz,
  pickup_name        text not null check (char_length(pickup_name) between 1 and 40), -- shown to restaurant instead of email
  customer_note      text check (char_length(customer_note) <= 300),
  currency           char(3) not null default 'AUD',
  subtotal_cents     integer not null check (subtotal_cents >= 0),
  service_fee_cents  integer not null default 0 check (service_fee_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  discount_cents     integer not null default 0 check (discount_cents >= 0),
  total_cents        integer not null check (total_cents >= 0),
  gst_cents          integer not null default 0 check (gst_cents >= 0),  -- GST included in total
  commission_rate_bps integer not null,                                   -- snapshot at order time
  commission_cents   integer not null check (commission_cents >= 0),
  restaurant_net_cents integer not null,
  source_video_id    uuid references public.videos(id) on delete set null,
  pricing_version    text not null,
  placed_at          timestamptz,
  accepted_at        timestamptz,
  ready_at           timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  estimated_ready_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (total_cents = subtotal_cents + service_fee_cents + delivery_fee_cents - discount_cents)
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_restaurant_status_idx on public.orders (restaurant_id, status, created_at desc);
create index orders_source_video_idx on public.orders (source_video_id) where source_video_id is not null;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  menu_item_id      uuid references public.menu_items(id) on delete set null,
  name              text not null,                    -- snapshot
  unit_price_cents  integer not null check (unit_price_cents >= 0),  -- base + options, snapshot
  quantity          smallint not null check (quantity between 1 and 50),
  options           jsonb not null default '[]',      -- [{id,name,price_delta_cents}]
  notes             text,
  line_total_cents  integer not null check (line_total_cents = unit_price_cents * quantity),
  source_video_id   uuid references public.videos(id) on delete set null
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_status_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  actor_id    uuid references auth.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index order_status_events_order_idx on public.order_status_events (order_id, created_at);

-- Database-level guard for the order state machine (the API enforces the same rules).
create or replace function public.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('pending_payment'::public.order_status, 'placed'::public.order_status),
    ('pending_payment', 'payment_failed'),
    ('pending_payment', 'cancelled'),
    ('payment_failed', 'pending_payment'),
    ('placed', 'accepted'),
    ('placed', 'rejected'),
    ('placed', 'cancelled'),
    ('accepted', 'preparing'),
    ('accepted', 'ready'),
    ('accepted', 'cancelled'),
    ('preparing', 'ready'),
    ('preparing', 'cancelled'),
    ('ready', 'completed'),
    ('ready', 'cancelled')
  );
$$;

create or replace function public.enforce_order_transition() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not public.order_transition_allowed(old.status, new.status) then
      raise exception 'Invalid order status transition % -> %', old.status, new.status using errcode = '23514';
    end if;
    case new.status
      when 'placed' then new.placed_at := coalesce(new.placed_at, now());
      when 'accepted' then new.accepted_at := coalesce(new.accepted_at, now());
      when 'ready' then new.ready_at := coalesce(new.ready_at, now());
      when 'completed' then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelled', 'rejected' then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
    insert into public.order_status_events (order_id, from_status, to_status, actor_id)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  -- Financial fields are immutable after creation.
  if (new.subtotal_cents, new.total_cents, new.commission_cents, new.commission_rate_bps, new.gst_cents, new.restaurant_net_cents)
     is distinct from (old.subtotal_cents, old.total_cents, old.commission_cents, old.commission_rate_bps, old.gst_cents, old.restaurant_net_cents) then
    raise exception 'Order financial fields are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger orders_transition before update on public.orders
  for each row execute function public.enforce_order_transition();

create table public.payments (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders(id) on delete restrict,
  provider                text not null default 'stripe',
  provider_payment_intent_id text unique,
  provider_charge_id      text,
  amount_cents            integer not null check (amount_cents > 0),
  application_fee_cents   integer not null default 0 check (application_fee_cents >= 0),
  currency                char(3) not null default 'AUD',
  status                  public.payment_status not null default 'requires_payment',
  failure_reason          text,
  is_test_mode            boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

create table public.refunds (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete restrict,
  payment_id        uuid references public.payments(id) on delete restrict,
  amount_cents      integer not null check (amount_cents > 0),
  reason            text not null check (reason in ('customer_request', 'restaurant_rejected', 'restaurant_cancelled', 'item_unavailable', 'quality_issue', 'duplicate', 'fraud', 'other')),
  details           text,
  status            public.refund_status not null default 'requested',
  provider_refund_id text unique,
  -- Who absorbs the refund: restaurant (reverse transfer) or platform.
  refund_application_fee boolean not null default true,
  initiated_by      uuid references auth.users(id),
  approved_by       uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index refunds_order_idx on public.refunds (order_id);
create index refunds_status_idx on public.refunds (status);
create trigger refunds_updated_at before update on public.refunds
  for each row execute function public.set_updated_at();

create table public.payment_disputes (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references public.payments(id) on delete restrict,
  provider_dispute_id text not null unique,
  amount_cents       integer not null,
  reason             text,
  status             text not null,
  evidence_due_by    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.restaurant_payouts (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete restrict,
  provider_payout_id text unique,
  amount_cents       integer not null,
  currency           char(3) not null default 'AUD',
  period_start       timestamptz,
  period_end         timestamptz,
  status             text not null default 'pending',
  arrival_date       date,
  created_at         timestamptz not null default now()
);
create index restaurant_payouts_restaurant_idx on public.restaurant_payouts (restaurant_id, created_at desc);

-- Idempotent record of processed payment-provider webhooks.
create table public.webhook_events (
  id            text primary key,           -- provider event id
  provider      text not null,
  type          text not null,
  payload       jsonb not null,
  processed_at  timestamptz,
  error         text,
  received_at   timestamptz not null default now()
);

-- Creator attribution: which video drove the order (last-touch within a window).
create table public.creator_attributions (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null unique references public.orders(id) on delete cascade,
  video_id         uuid not null references public.videos(id) on delete cascade,
  creator_id       uuid references public.creators(user_id) on delete set null,
  attribution_model text not null default 'last_touch_order_button',
  attributed_revenue_cents integer not null,
  created_at       timestamptz not null default now()
);
create index creator_attributions_creator_idx on public.creator_attributions (creator_id, created_at desc);
create index creator_attributions_video_idx on public.creator_attributions (video_id);

create table public.creator_commissions (
  id              uuid primary key default gen_random_uuid(),
  attribution_id  uuid not null unique references public.creator_attributions(id) on delete cascade,
  creator_id      uuid not null references public.creators(user_id) on delete cascade,
  rate_bps        integer not null,
  amount_cents    integer not null check (amount_cents >= 0),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'void')),
  created_at      timestamptz not null default now()
);
