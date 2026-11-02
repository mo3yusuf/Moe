import { afterAll, describe, expect, it } from 'vitest';
import { as, asExpectError, ids, sql } from './helpers';

const U = ids.users;
const R = ids.restaurants;

afterAll(async () => {
  await sql.end();
});

describe('row-level security: public catalogue', () => {
  it('anonymous users see active restaurants but not ones pending verification', async () => {
    const rows = await as(null, (tx) => tx<{ id: string }[]>`select id from public.restaurants`);
    const visible = rows.map((r) => r.id);
    expect(visible).toContain(R.ember);
    expect(visible).not.toContain(R.sweet);
  });

  it('anonymous users can read menus of active restaurants only', async () => {
    const items = await as(null, (tx) => tx<{ restaurant_id: string }[]>`select restaurant_id from public.menu_items`);
    expect(items.some((i) => i.restaurant_id === R.kaizen)).toBe(true);
    expect(items.some((i) => i.restaurant_id === R.sweet)).toBe(false);
  });

  it('pending video→menu links are hidden from the public', async () => {
    const links = await as(null, (tx) => tx<{ video_id: string }[]>`select video_id from public.video_menu_items`);
    expect(links.map((l) => l.video_id)).not.toContain(ids.videos.v_wontons);
  });

  it('verification documents are only visible to the owner and admins', async () => {
    expect(await as(U.customer!, (tx) => tx`select * from public.restaurant_verifications`)).toHaveLength(0);
    expect((await as(U.owner_ember!, (tx) => tx`select * from public.restaurant_verifications`)).length).toBe(1);
    expect((await as(U.admin!, (tx) => tx`select * from public.restaurant_verifications`)).length).toBe(7);
  });
});

describe('row-level security: personal data', () => {
  it('customers can only read and update their own preferences', async () => {
    const mine = await as(U.customer!, (tx) => tx`select user_id from public.user_preferences`);
    expect(mine).toEqual([{ user_id: U.customer }]);
    const updated = await as(U.customer!, (tx) => tx`update public.user_preferences set favourite_cuisines = '{Thai}' where user_id = ${U.customer2!} returning user_id`);
    expect(updated).toHaveLength(0);
  });

  it('users cannot grant themselves admin', async () => {
    const err = await asExpectError(U.customer!, (tx) => tx`insert into public.user_roles (user_id, role) values (${U.customer!}, 'admin')`);
    expect(err.message).toMatch(/row-level security/);
  });

  it('users cannot tamper with server-managed profile counters', async () => {
    const [row] = await as(U.customer!, async (tx) => {
      await tx`update public.profiles set follower_count = 999999, bio = 'hi' where id = ${U.customer!}`;
      return tx<{ follower_count: number; bio: string }[]>`select follower_count, bio from public.profiles where id = ${U.customer!}`;
    });
    expect(row).toMatchObject({ follower_count: 0, bio: 'hi' });
  });

  it('taste profiles and interaction logs are private to their owner', async () => {
    await sql`insert into public.user_taste_profiles (user_id, profile, config_version) values (${U.customer2!}, '{}', 't') on conflict do nothing`;
    expect(await as(U.customer!, (tx) => tx`select * from public.user_taste_profiles where user_id = ${U.customer2!}`)).toHaveLength(0);
    expect(await as(U.customer!, (tx) => tx`select * from public.video_interactions where user_id <> ${U.customer!}`)).toHaveLength(0);
  });
});

describe('row-level security: orders and money', () => {
  it('clients cannot create orders, payments or ledger entries directly', async () => {
    const err = await asExpectError(U.customer!, (tx) => tx`
      insert into public.orders (customer_id, restaurant_id, location_id, market_id, currency, subtotal_cents, total_cents, gst_included_cents,
        commission_bps, commission_cents, restaurant_net_cents, pickup_name, idempotency_key)
      values (${U.customer!}, ${R.ember!}, ${ids.locations.ember!}, (select id from public.markets where code = 'au-bne'), 'AUD', 100, 100, 9, 1000, 10, 90, 'Sam', 'x')`);
    expect(err.message).toMatch(/row-level security/);
    const err2 = await asExpectError(U.owner_ember!, (tx) => tx`
      insert into public.ledger_entries (party, entry_type, amount_cents, currency) values ('restaurant', 'payout', 100000, 'AUD')`);
    expect(err2.message).toMatch(/row-level security/);
  });

  it('only admins can change commission settings', async () => {
    const err = await asExpectError(U.owner_ember!, (tx) => tx`insert into public.commission_agreements (restaurant_id, commission_bps) values (${R.ember!}, 0)`);
    expect(err.message).toMatch(/row-level security/);
    const updated = await as(U.owner_ember!, (tx) => tx`update public.platform_settings set value = '{"bps": 0}' where key = 'default_commission' returning key`);
    expect(updated).toHaveLength(0);
    const adminUpdated = await as(U.admin!, (tx) => tx`update public.platform_settings set value = '{"bps": 1200}' where key = 'default_commission' returning key`);
    expect(adminUpdated).toHaveLength(1);
  });

  it('the database rejects invalid order status jumps even for privileged writers', async () => {
    const err = await asExpectError(null, async () => {
      await sql.begin(async (tx) => {
        const [o] = await tx<{ id: string }[]>`
          insert into public.orders (customer_id, restaurant_id, location_id, market_id, currency, subtotal_cents, total_cents, gst_included_cents,
            commission_bps, commission_cents, restaurant_net_cents, pickup_name, idempotency_key)
          values (${U.customer!}, ${R.ember!}, ${ids.locations.ember!}, (select id from public.markets where code = 'au-bne'), 'AUD', 1100, 1100, 100, 1000, 110, 990, 'Sam', 'rls-test')
          returning id`;
        await tx`update public.orders set status = 'completed' where id = ${o!.id}`;
      });
    });
    expect(err.message).toMatch(/Invalid order status transition pending_payment -> completed/);
  });
});

describe('row-level security: restaurants & menus', () => {
  it('owners can edit their own menu but not a competitor’s', async () => {
    const own = await as(U.owner_ember!, (tx) => tx`update public.menu_items set price_cents = 1990 where id = ${ids.items['ember:smash']!} returning id`);
    expect(own).toHaveLength(1);
    const other = await as(U.owner_ember!, (tx) => tx`update public.menu_items set price_cents = 1 where id = ${ids.items['kaizen:aburi']!} returning id`);
    expect(other).toHaveLength(0);
  });

  it('restaurants cannot activate themselves, change payment fields or enable delivery', async () => {
    const err = await asExpectError(U.owner_sweet!, (tx) => tx`update public.restaurants set status = 'active' where id = ${R.sweet!}`);
    expect(err.message).toMatch(/Only CRAVE administrators/);
    const [row] = await as(U.owner_ember!, async (tx) => {
      await tx`update public.restaurants set stripe_account_id = 'acct_evil', delivery_enabled = true, accepting_orders = false where id = ${R.ember!}`;
      return tx<{ stripe_account_id: string | null; delivery_enabled: boolean; accepting_orders: boolean }[]>`
        select stripe_account_id, delivery_enabled, accepting_orders from public.restaurants where id = ${R.ember!}`;
    });
    expect(row).toEqual({ stripe_account_id: null, delivery_enabled: false, accepting_orders: false });
  });

  it('new restaurants start as drafts owned by their creator and enter review on verification', async () => {
    const result = await as(U.customer2!, async (tx) => {
      const [r] = await tx<{ id: string; status: string }[]>`
        insert into public.restaurants (slug, name, market_id, status, accepting_orders)
        values ('test-new-cafe', 'New Cafe', (select id from public.markets where code = 'au-bne'), 'active', true)
        returning id, status`;
      const members = await tx`select role from public.restaurant_members where restaurant_id = ${r!.id}`;
      await tx`insert into public.restaurant_verifications (restaurant_id, legal_business_name, abn, gst_registered, business_contact_name, business_contact_email, business_contact_phone, status)
               values (${r!.id}, 'New Cafe Pty Ltd', '51824753556', true, 'Alex', 'alex@example.com', '0400000000', 'approved')`;
      const [after] = await tx<{ status: string }[]>`select status from public.restaurants where id = ${r!.id}`;
      const [v] = await tx<{ status: string }[]>`select status from public.restaurant_verifications where restaurant_id = ${r!.id}`;
      return { initial: r!.status, members, after: after!.status, verification: v!.status };
    });
    expect(result).toEqual({ initial: 'draft', members: [{ role: 'owner' }], after: 'pending_verification', verification: 'submitted' });
  });

  it('staff can mark items sold out but cannot change prices', async () => {
    await sql`insert into public.restaurant_members (restaurant_id, user_id, role) values (${R.bao!}, ${U.customer2!}, 'staff') on conflict do nothing`;
    try {
      const ok = await as(U.customer2!, (tx) => tx`update public.menu_items set is_available = false where id = ${ids.items['bao:porkbao']!} returning id`);
      expect(ok).toHaveLength(1);
      const err = await asExpectError(U.customer2!, (tx) => tx`update public.menu_items set price_cents = 100 where id = ${ids.items['bao:porkbao']!}`);
      expect(err.message).toMatch(/Staff can only change item availability/);
    } finally {
      await sql`delete from public.restaurant_members where restaurant_id = ${R.bao!} and user_id = ${U.customer2!}`;
    }
  });
});

describe('row-level security: creators & videos', () => {
  it('uploads always start in processing and cannot be self-published', async () => {
    const result = await as(U.creator2!, async (tx) => {
      const [v] = await tx<{ id: string; status: string; is_demo: boolean }[]>`
        insert into public.videos (uploader_id, caption, status, is_demo, like_count) values (${U.creator2!}, 'new clip', 'published', true, 5000)
        returning id, status, is_demo`;
      return v!;
    });
    expect(result).toMatchObject({ status: 'processing', is_demo: false });
    const err = await asExpectError(U.creator2!, async (tx) => {
      const [v] = await tx<{ id: string }[]>`insert into public.videos (uploader_id, caption) values (${U.creator2!}, 'x') returning id`;
      await tx`update public.videos set status = 'published' where id = ${v!.id}`;
    });
    expect(err.message).toMatch(/Video status is managed by CRAVE/);
  });

  it('creator tags start pending, and auto-approve only where the restaurant granted permission', async () => {
    const statuses = await as(U.creator2!, async (tx) => {
      const [v] = await tx<{ id: string }[]>`insert into public.videos (uploader_id, caption) values (${U.creator2!}, 'tag test') returning id`;
      const [l] = await tx<{ status: string }[]>`
        insert into public.video_menu_items (video_id, menu_item_id, restaurant_id, status) values (${v!.id}, ${ids.items['ember:fries']!}, ${R.ember!}, 'approved')
        returning status`;
      return l!.status;
    });
    expect(statuses).toBe('pending');

    const auto = await as(U.creator1!, async (tx) => {
      const [v] = await tx<{ id: string }[]>`insert into public.videos (uploader_id, caption) values (${U.creator1!}, 'tag test') returning id`;
      const [l] = await tx<{ status: string }[]>`
        insert into public.video_menu_items (video_id, menu_item_id, restaurant_id) values (${v!.id}, ${ids.items['ember:fries']!}, ${R.ember!}) returning status`;
      return l!.status;
    });
    expect(auto).toBe('approved'); // Ember granted creator1 auto_approve_tags
  });

  it('a creator cannot approve their own pending tag; the restaurant can', async () => {
    const updated = await as(U.creator2!, (tx) => tx`
      update public.video_menu_items set status = 'approved' where video_id = ${ids.videos.v_wontons!} returning status`);
    expect(updated).toHaveLength(0); // RLS: the row is not updatable by the creator
    const [still] = await sql<{ status: string }[]>`select status from public.video_menu_items where video_id = ${ids.videos.v_wontons!}`;
    expect(still!.status).toBe('pending');
    const approved = await as(U.owner_bao!, (tx) => tx<{ status: string; reviewed_by: string }[]>`
      update public.video_menu_items set status = 'approved' where video_id = ${ids.videos.v_wontons!} returning status, reviewed_by`);
    expect(approved).toEqual([{ status: 'approved', reviewed_by: U.owner_bao }]);
  });

  it('tags must reference a menu item of the tagged restaurant', async () => {
    const err = await asExpectError(U.creator1!, async (tx) => {
      const [v] = await tx<{ id: string }[]>`insert into public.videos (uploader_id, caption) values (${U.creator1!}, 'x') returning id`;
      await tx`insert into public.video_menu_items (video_id, menu_item_id, restaurant_id) values (${v!.id}, ${ids.items['kaizen:aburi']!}, ${R.ember!})`;
    });
    expect(err.message).toMatch(/does not belong to restaurant/);
  });

  it('users can report content but cannot resolve reports', async () => {
    const [r] = await as(U.customer!, (tx) => tx<{ status: string; reporter_id: string }[]>`
      insert into public.moderation_reports (target_type, target_id, reason, status) values ('video', ${ids.videos.v_food_tour!}, 'spam', 'dismissed')
      returning status, reporter_id`);
    expect(r).toEqual({ status: 'open', reporter_id: U.customer });
  });
});

describe('Reset My Taste Profile', () => {
  it('deletes only the caller’s learned data', async () => {
    await sql`insert into public.video_interactions (user_id, client_event_id, event_type, video_id, occurred_at)
              values (${U.customer!}, gen_random_uuid(), 'like', ${ids.videos.v_aburi!}, now()),
                     (${U.customer2!}, gen_random_uuid(), 'like', ${ids.videos.v_aburi!}, now())`;
    const remaining = await as(U.customer!, async (tx) => {
      await tx`select public.reset_my_taste_profile()`;
      return tx<{ n: number }[]>`select count(*)::int as n from public.video_interactions where user_id = ${U.customer!}`;
    });
    expect(remaining[0]!.n).toBe(0);
    const [other] = await sql<{ n: number }[]>`select count(*)::int as n from public.video_interactions where user_id = ${U.customer2!}`;
    expect(other!.n).toBeGreaterThan(0);
    await sql`delete from public.video_interactions where user_id in (${U.customer!}, ${U.customer2!})`;
  });

  it('cannot be called anonymously', async () => {
    const err = await asExpectError(null, (tx) => tx`select public.reset_my_taste_profile()`);
    expect(err.message).toMatch(/Not authenticated|permission denied/);
  });
});
