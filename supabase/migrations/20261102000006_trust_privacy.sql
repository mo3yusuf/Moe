-- Notifications, privacy consent, data deletion, moderation reports/appeals, fraud flags, support.

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,                 -- order_status, tag_request, moderation, ...
  title      text not null,
  body       text,
  data       jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- Append-only consent log (APP 1 / APP 5 transparency). Latest row per (user, type) wins.
create table public.privacy_consents (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  consent_type   text not null check (consent_type in ('personalisation', 'precise_location', 'marketing_email', 'marketing_push', 'analytics')),
  granted        boolean not null,
  policy_version text not null,
  source         text not null default 'app' check (source in ('app', 'web', 'onboarding', 'support')),
  created_at     timestamptz not null default now()
);
create index privacy_consents_user_type_idx on public.privacy_consents (user_id, consent_type, created_at desc);

create or replace view public.current_privacy_consents with (security_invoker = true) as
  select distinct on (user_id, consent_type) user_id, consent_type, granted, policy_version, created_at
  from public.privacy_consents
  order by user_id, consent_type, created_at desc;

create or replace function public.has_consent(p_user_id uuid, p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select granted from public.privacy_consents
    where user_id = p_user_id and consent_type = p_type
    order by created_at desc, id desc limit 1), false);
$$;

create table public.data_deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  request_type text not null default 'account_deletion' check (request_type in ('account_deletion', 'data_export', 'recommendation_data')),
  status       text not null default 'received' check (status in ('received', 'processing', 'completed', 'rejected')),
  notes        text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.content_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references auth.users(id) on delete set null,
  target_type  text not null check (target_type in ('video', 'comment', 'restaurant', 'profile', 'menu_item')),
  target_id    uuid not null,
  reason       text not null check (reason in ('spam', 'misleading', 'food_safety', 'hate', 'harassment', 'nudity', 'violence', 'copyright', 'undisclosed_ad', 'other')),
  details      text check (char_length(details) <= 1000),
  status       text not null default 'open' check (status in ('open', 'in_review', 'actioned', 'dismissed')),
  reviewed_by  uuid references auth.users(id),
  decision_notes text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index content_reports_status_idx on public.content_reports (status, created_at);
create index content_reports_target_idx on public.content_reports (target_type, target_id);

create table public.moderation_appeals (
  id           uuid primary key default gen_random_uuid(),
  appellant_id uuid not null references auth.users(id) on delete cascade,
  target_type  text not null check (target_type in ('video', 'comment', 'restaurant', 'profile')),
  target_id    uuid not null,
  report_id    uuid references public.content_reports(id) on delete set null,
  body         text not null check (char_length(body) between 10 and 2000),
  status       text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  reviewed_by  uuid references auth.users(id),
  decision_notes text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);

create table public.fraud_flags (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('user', 'restaurant', 'order', 'payment', 'creator')),
  entity_id   uuid not null,
  rule        text not null,                -- e.g. 'velocity_orders_per_hour', 'refund_ratio'
  severity    text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  details     jsonb not null default '{}',
  status      text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'false_positive')),
  resolved_by uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index fraud_flags_status_idx on public.fraud_flags (status, severity);

create table public.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  opened_by     uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  subject       text not null check (char_length(subject) <= 140),
  body          text not null check (char_length(body) <= 4000),
  status        text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger support_tickets_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();
