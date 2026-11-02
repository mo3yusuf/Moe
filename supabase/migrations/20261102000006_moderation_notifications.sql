-- =============================================================================
-- CRAVE — Moderation, appeals, fraud flags, notifications, account deletion, audit
-- =============================================================================

create type public.report_target as enum ('video', 'comment', 'profile', 'restaurant', 'video_link');
create type public.report_reason as enum (
  'inappropriate', 'misleading_restaurant_tag', 'spam', 'copyright', 'food_safety', 'harassment',
  'undisclosed_sponsorship', 'other'
);
create type public.report_status as enum ('open', 'actioned', 'dismissed');
create type public.moderation_action_type as enum (
  'hide_video', 'remove_video', 'restore_video', 'hide_comment', 'remove_comment', 'restore_comment',
  'reject_link', 'warn_user', 'suspend_user', 'suspend_restaurant', 'reinstate_restaurant', 'dismiss'
);

create table public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  target_type public.report_target not null,
  target_id uuid not null,
  reason public.report_reason not null,
  details text check (char_length(details) <= 1000),
  status public.report_status not null default 'open',
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index moderation_reports_open_idx on public.moderation_reports (created_at) where status = 'open';
create index moderation_reports_target_idx on public.moderation_reports (target_type, target_id);
-- One open report per reporter per target (spam protection).
create unique index moderation_reports_dedupe on public.moderation_reports (reporter_id, target_type, target_id) where status = 'open';

create or replace function public.protect_report_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    new.reporter_id := auth.uid();
    new.status := 'open';
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end $$;
create trigger moderation_reports_protect before insert on public.moderation_reports for each row execute function public.protect_report_columns();

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.moderation_reports(id) on delete set null,
  target_type public.report_target not null,
  target_id uuid not null,
  action public.moderation_action_type not null,
  moderator_id uuid references auth.users(id) on delete set null,
  reason_shown_to_user text,              -- explanation shown to the affected user
  internal_notes text,
  created_at timestamptz not null default now()
);
create index moderation_actions_target_idx on public.moderation_actions (target_type, target_id, created_at desc);

create table public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.moderation_actions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (action_id, user_id)
);

create table public.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'order', 'restaurant', 'payment', 'video')),
  subject_id uuid not null,
  rule text not null,                     -- e.g. 'many_failed_payments', 'self_order_creator'
  severity text not null check (severity in ('low', 'medium', 'high')),
  details jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'reviewing', 'cleared', 'confirmed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index fraud_flags_open_idx on public.fraud_flags (severity, created_at) where status in ('open', 'reviewing');

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                     -- 'order_status', 'link_review', 'moderation', ...
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Account deletion & admin audit
-- ---------------------------------------------------------------------------
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,                  -- not FK: must outlive the auth user
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'completed', 'blocked')),
  blocked_reason text
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_audit_log_subject_idx on public.admin_audit_log (subject_type, subject_id, created_at desc);

-- Anonymise retained records before the auth user is deleted. Orders and the
-- financial ledger are retained (ATO record-keeping: 5 years) without identity.
create or replace function public.anonymise_user_for_deletion(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set pickup_name = 'Deleted customer', customer_note = null where customer_id = uid;
  update public.moderation_reports set details = null where reporter_id = uid;
  update public.profiles set username = null, display_name = 'Deleted user', avatar_url = null, bio = null,
    deleted_at = now() where id = uid;
end $$;
revoke all on function public.anonymise_user_for_deletion(uuid) from public;
