-- Transactional email outbox. The API worker claims notifications (and paid orders for receipts),
-- emails them through Resend, then marks them sent. Claims are leased (5 min) so a crashed worker's
-- emails are retried, give up after 5 attempts, and use SKIP LOCKED so two workers never send the
-- same email. Only the server (service role) can call these functions.

alter table public.notifications
  add column emailed_at timestamptz,
  add column email_attempts smallint not null default 0,
  add column email_claimed_at timestamptz;

alter table public.orders
  add column receipt_emailed_at timestamptz,
  add column receipt_email_attempts smallint not null default 0,
  add column receipt_claimed_at timestamptz;

create index notifications_email_outbox_idx on public.notifications (created_at)
  where emailed_at is null and email_attempts < 5 and type in ('new_order', 'order_status', 'refund');
create index orders_receipt_outbox_idx on public.orders (placed_at)
  where receipt_emailed_at is null and receipt_email_attempts < 5 and placed_at is not null;

create or replace function public.email_outbox_claim(p_limit integer default 20)
returns table (id uuid, user_id uuid, email text, display_name text, type text, title text, body text, data jsonb, restaurant_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Server only' using errcode = '42501'; end if;
  return query
  with picked as (
    select n.id from public.notifications n
    where n.emailed_at is null and n.email_attempts < 5
      -- Emailed: new-order alerts to restaurant staff, "ready"/"rejected"/"cancelled" to customers, and
      -- completed refunds. Other notifications stay in-app only.
      and (n.type = 'new_order'
           or (n.type = 'order_status' and n.data ->> 'status' in ('ready', 'rejected', 'cancelled'))
           or (n.type = 'refund' and n.data ? 'amount_cents'))
      and n.created_at > now() - interval '2 days'
      and (n.email_claimed_at is null or n.email_claimed_at < now() - interval '5 minutes')
    order by n.created_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  ), claimed as (
    update public.notifications n set email_claimed_at = now(), email_attempts = n.email_attempts + 1
    from picked where n.id = picked.id
    returning n.*
  )
  select c.id, c.user_id, u.email::text, coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1)), c.type, c.title, c.body, c.data,
         (select o.restaurant_id from public.orders o where o.id::text = c.data ->> 'order_id')
  from claimed c join auth.users u on u.id = c.user_id left join public.profiles p on p.id = c.user_id
  where u.email is not null;
end $$;

create or replace function public.email_outbox_done(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Server only' using errcode = '42501'; end if;
  update public.notifications set emailed_at = now() where id = any (p_ids);
end $$;

-- Paid orders that still need a customer receipt, with everything the email shows.
create or replace function public.receipt_outbox_claim(p_limit integer default 20)
returns table (order_id uuid, email text, display_name text, order_number text, restaurant_name text, pickup_name text,
               placed_at timestamptz, subtotal_cents integer, service_fee_cents integer, delivery_fee_cents integer,
               total_cents integer, gst_cents integer, currency text, items jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Server only' using errcode = '42501'; end if;
  return query
  with picked as (
    select o.id from public.orders o
    where o.receipt_emailed_at is null and o.receipt_email_attempts < 5 and o.placed_at is not null
      and o.user_id is not null and o.placed_at > now() - interval '2 days'
      and (o.receipt_claimed_at is null or o.receipt_claimed_at < now() - interval '5 minutes')
    order by o.placed_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  ), claimed as (
    update public.orders o set receipt_claimed_at = now(), receipt_email_attempts = o.receipt_email_attempts + 1
    from picked where o.id = picked.id
    returning o.*
  )
  select c.id, u.email::text, coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1)), c.order_number, r.name, c.pickup_name,
         c.placed_at, c.subtotal_cents, c.service_fee_cents, coalesce(c.delivery_fee_cents, 0), c.total_cents, c.gst_cents, c.currency::text,
         coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'lineTotalCents', i.line_total_cents,
                    'options', (select coalesce(jsonb_agg(x ->> 'name'), '[]'::jsonb) from jsonb_array_elements(i.options) x), 'notes', i.notes) order by i.id)
                   from public.order_items i where i.order_id = c.id), '[]'::jsonb)
  from claimed c join auth.users u on u.id = c.user_id join public.restaurants r on r.id = c.restaurant_id
  left join public.profiles p on p.id = c.user_id
  where u.email is not null;
end $$;

create or replace function public.receipt_outbox_done(p_order_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.request_is_privileged() then raise exception 'Server only' using errcode = '42501'; end if;
  update public.orders set receipt_emailed_at = now() where id = any (p_order_ids);
end $$;

revoke all on function public.email_outbox_claim(integer), public.email_outbox_done(uuid[]),
                       public.receipt_outbox_claim(integer), public.receipt_outbox_done(uuid[]) from public, anon, authenticated;
