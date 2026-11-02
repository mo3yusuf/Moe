// Database tests: row-level security, protection triggers, order state machine and privacy functions.
// Run with `npm run test:db` (boots a throwaway PostgreSQL cluster; see run.sh).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.CRAVE_TEST_DB_URL;
if (!url) throw new Error('CRAVE_TEST_DB_URL not set — run via supabase/tests/run.sh');

const pool = new pg.Pool({ connectionString: url, max: 4 });
const id = (key) => `md5('${key}')::uuid`;

// Each test runs inside a transaction that is rolled back, so tests are isolated.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    return await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

async function createUser(c, email, meta = {}) {
  await asSuperuser(c);
  const { rows } = await c.query(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, meta]);
  return rows[0].id;
}

// Switch the session to an end-user (or anon) identity, as PostgREST does with a verified JWT.
async function as(c, userId) {
  await c.query('reset role');
  if (userId === 'anon') {
    await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    await c.query('set local role anon');
  } else {
    await c.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await c.query('set local role authenticated');
  }
}
async function asSuperuser(c) {
  await c.query('reset role');
  await c.query(`select set_config('request.jwt.claims', '', true)`);
}

async function expectDenied(c, sql, params = []) {
  await c.query('savepoint s');
  try {
    const res = await c.query(sql, params);
    await c.query('release savepoint s');
    return res; // caller asserts rowCount when RLS filters silently
  } catch (err) {
    await c.query('rollback to savepoint s');
    return { error: err };
  }
}

before(async () => { await pool.query('select 1'); });
after(async () => { await pool.end(); });

test('every public table has row-level security enabled', async () => {
  const { rows } = await pool.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assert.deepEqual(rows, []);
});

test('sign-up creates a profile and customer role', () => tx(async (c) => {
  const uid = await createUser(c, 'new@example.com', { display_name: 'Nina' });
  const { rows } = await c.query('select p.display_name, r.role from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = $1', [uid]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].display_name, 'Nina');
  assert.equal(rows[0].role, 'customer');
}));

test('sign-up consent choices are recorded server-side; junk keys ignored', () => tx(async (c) => {
  const uid = await createUser(c, 'consent@example.com', {
    policy_version: 'v-test',
    consents: { personalisation: true, marketing_email: false, sell_my_data: true, analytics: 'yes' },
  });
  const { rows } = await c.query(
    'select consent_type, granted, policy_version from public.privacy_consents where user_id = $1 order by consent_type', [uid]);
  assert.deepEqual(rows, [
    { consent_type: 'marketing_email', granted: false, policy_version: 'v-test' },
    { consent_type: 'personalisation', granted: true, policy_version: 'v-test' },
  ]);
  assert.equal((await c.query('select public.has_consent($1, $2) as ok', [uid, 'personalisation'])).rows[0].ok, true);
}));

test('unverified restaurants and their menus are hidden from customers and anon', () => tx(async (c) => {
  const uid = await createUser(c, 'cust@example.com');
  for (const who of ['anon', uid]) {
    await as(c, who);
    const r = await c.query(`select id from public.restaurants where id = ${id('r-pending-pho')}`);
    assert.equal(r.rowCount, 0, `pending restaurant visible to ${who}`);
    const m = await c.query(`select id from public.menu_items where id = ${id('i-pho-beef')}`);
    assert.equal(m.rowCount, 0);
    const v = await c.query(`select count(*)::int n from public.restaurants where status = 'verified'`);
    assert.equal(v.rows[0].n, 8);
  }
}));

test('users can only read their own full profile; public_profiles exposes display fields only', () => tx(async (c) => {
  const a = await createUser(c, 'a@example.com', { display_name: 'A' });
  const b = await createUser(c, 'b@example.com', { display_name: 'B' });
  await as(c, a);
  assert.equal((await c.query('select * from public.profiles where id = $1', [b])).rowCount, 0);
  assert.equal((await c.query('select * from public.profiles where id = $1', [a])).rowCount, 1);
  const pub = await c.query('select * from public.public_profiles where id = $1', [b]);
  assert.deepEqual(Object.keys(pub.rows[0]).sort(), ['avatar_url', 'bio', 'display_name', 'id', 'username']);
}));

test('restaurant onboarding: creator becomes owner; status and commission are protected', () => tx(async (c) => {
  const owner = await createUser(c, 'owner@example.com');
  await as(c, owner);
  const { rows } = await c.query(`
    insert into public.restaurants (name, slug, created_by, status, commission_rate_bps)
    values ('Test Cafe', 'test-cafe', $1, 'verified', 0) returning id, status, commission_rate_bps`, [owner]);
  const rid = rows[0].id;
  assert.equal(rows[0].status, 'draft', 'owner cannot self-verify on insert');
  assert.equal(rows[0].commission_rate_bps, 1000, 'default commission applied');

  const mem = await c.query('select role from public.restaurant_members where restaurant_id = $1 and user_id = $2', [rid, owner]);
  assert.equal(mem.rows[0].role, 'owner');

  // Owner can see their own draft restaurant, and add menu items
  await c.query(`insert into public.menu_items (restaurant_id, name, price_cents) values ($1, 'Flat white', 550)`, [rid]);

  let res = await expectDenied(c, `update public.restaurants set status = 'verified' where id = $1`, [rid]);
  assert.ok(res.error, 'owner cannot verify');
  res = await expectDenied(c, `update public.restaurants set commission_rate_bps = 500 where id = $1`, [rid]);
  assert.ok(res.error, 'owner cannot change commission');
  await c.query(`update public.restaurants set status = 'pending_verification' where id = $1`, [rid]);

  // A different user cannot see or edit the draft restaurant
  const stranger = await createUser(c, 'stranger@example.com');
  await as(c, stranger);
  assert.equal((await c.query('select 1 from public.restaurants where id = $1', [rid])).rowCount, 0);
  res = await expectDenied(c, `update public.restaurants set name = 'Hacked' where id = $1`, [rid]);
  assert.equal(res.rowCount ?? 0, 0);
  res = await expectDenied(c, `insert into public.menu_items (restaurant_id, name, price_cents) values ($1, 'x', 1)`, [rid]);
  assert.ok(res.error);
}));

test('admin verification flow and commission change are audited', () => tx(async (c) => {
  const owner = await createUser(c, 'o2@example.com');
  const admin = await createUser(c, 'admin@example.com');
  await c.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [admin]);
  await as(c, owner);
  const rid = (await c.query(`insert into public.restaurants (name, slug, created_by) values ('Cafe Two', 'cafe-two', $1) returning id`, [owner])).rows[0].id;
  const vid = (await c.query(`insert into public.restaurant_verifications (restaurant_id, submitted_by) values ($1, $2) returning id`, [rid, owner])).rows[0].id;

  let res = await expectDenied(c, 'select public.admin_decide_verification($1, true)', [vid]);
  assert.ok(res.error, 'non-admin cannot verify');

  await as(c, admin);
  await c.query('select public.admin_decide_verification($1, true, $2)', [vid, 'Licence checked']);
  await c.query('select public.admin_set_commission($1, 800, $2)', [rid, 'Launch partner']);
  const r = await c.query('select status, commission_rate_bps from public.restaurants where id = $1', [rid]);
  assert.equal(r.rows[0].status, 'verified');
  assert.equal(r.rows[0].commission_rate_bps, 800);
  const audit = await c.query(`select action from public.audit_log where entity_id = $1 order by id`, [rid]);
  assert.deepEqual(audit.rows.map((x) => x.action), ['restaurant_verified', 'commission_changed']);
}));

test('video upload cannot self-publish; moderation publishes', () => tx(async (c) => {
  const uid = await createUser(c, 'creator@example.com');
  const admin = await createUser(c, 'mod@example.com');
  await c.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [admin]);
  await as(c, uid);
  const v = (await c.query(`insert into public.videos (uploader_id, storage_path, caption, status, playback_url)
    values ($1::uuid, $1::text || '/clip.mp4', 'my review', 'published', 'https://evil.example/x.mp4') returning id, status, playback_url`, [uid])).rows[0];
  assert.equal(v.status, 'uploading');
  assert.equal(v.playback_url, null);

  // Cannot submit for review without rights attestation (check constraint)
  let res = await expectDenied(c, `update public.videos set status = 'pending_review' where id = $1`, [v.id]);
  assert.ok(res.error);
  await c.query(`update public.videos set status = 'pending_review', rights_attested_at = now() where id = $1`, [v.id]);
  res = await expectDenied(c, `update public.videos set status = 'published' where id = $1`, [v.id]);
  assert.ok(res.error, 'uploader cannot publish');

  // Not visible to other users until published
  const other = await createUser(c, 'viewer@example.com');
  await as(c, other);
  assert.equal((await c.query('select 1 from public.videos where id = $1', [v.id])).rowCount, 0);

  await as(c, admin);
  await c.query(`select public.admin_moderate_video($1, 'published', 'ok')`, [v.id]);
  await as(c, other);
  const pub = await c.query('select published_at from public.videos where id = $1', [v.id]);
  assert.equal(pub.rowCount, 1);
  assert.ok(pub.rows[0].published_at);
}));

test('restaurant videos can only be uploaded by restaurant members', () => tx(async (c) => {
  const uid = await createUser(c, 'notstaff@example.com');
  await as(c, uid);
  const res = await expectDenied(c, `insert into public.videos (uploader_id, source, restaurant_id) values ($1, 'restaurant', ${id('r-valley-smash')})`, [uid]);
  assert.ok(res.error);
}));

test('creator menu tags start pending and only the restaurant can approve', () => tx(async (c) => {
  const creator = await createUser(c, 'tagger@example.com');
  await as(c, creator);
  const vid = (await c.query(`insert into public.videos (uploader_id, caption) values ($1, 'tag test') returning id`, [creator])).rows[0].id;
  const link = (await c.query(`insert into public.video_menu_items (video_id, menu_item_id, restaurant_id, status)
     values ($1, ${id('i-smash-classic')}, ${id('r-kurilpa-sushi')}, 'approved') returning status, restaurant_id`, [vid])).rows[0];
  assert.equal(link.status, 'pending', 'creator cannot self-approve');
  assert.equal((await c.query(`select ${id('r-valley-smash')} as r`)).rows[0].r, link.restaurant_id, 'restaurant derived from menu item');

  let res = await expectDenied(c, `update public.video_menu_items set status = 'approved' where video_id = $1`, [vid]);
  assert.ok(res.error, 'creator cannot approve their own tag');

  // Demo owner manages Valley Smash
  await as(c, (await c.query(`select ${id('user-demo-owner')} as u`)).rows[0].u);
  await c.query(`update public.video_menu_items set status = 'approved' where video_id = $1`, [vid]);
  const after = await c.query('select status, decided_at from public.video_menu_items where video_id = $1', [vid]);
  assert.equal(after.rows[0].status, 'approved');
  assert.ok(after.rows[0].decided_at);
}));

test('swipe and interaction events: insert own only, read own only', () => tx(async (c) => {
  const a = await createUser(c, 'sa@example.com');
  const b = await createUser(c, 'sb@example.com');
  await as(c, a);
  await c.query(`insert into public.swipe_events (user_id, video_id, direction) values ($1, ${id('video-v1')}, 'right')`, [a]);
  await c.query(`insert into public.video_interactions (user_id, video_id, event_type, watch_ms, completion_pct) values ($1, ${id('video-v1')}, 'watch', 9000, 60)`, [a]);
  const res = await expectDenied(c, `insert into public.swipe_events (user_id, video_id, direction) values ($1, ${id('video-v1')}, 'left')`, [b]);
  assert.ok(res.error, 'cannot write events for another user');
  await as(c, b);
  assert.equal((await c.query('select 1 from public.swipe_events')).rowCount, 0);
  assert.equal((await c.query('select 1 from public.video_interactions')).rowCount, 0);
}));

test('idempotent events: duplicate client_event_id is rejected', () => tx(async (c) => {
  const a = await createUser(c, 'idem@example.com');
  await as(c, a);
  const ev = '11111111-1111-4111-8111-111111111111';
  await c.query(`insert into public.swipe_events (user_id, video_id, direction, client_event_id) values ($1, ${id('video-v1')}, 'right', $2)`, [a, ev]);
  const res = await expectDenied(c, `insert into public.swipe_events (user_id, video_id, direction, client_event_id) values ($1, ${id('video-v1')}, 'right', $2)`, [a, ev]);
  assert.equal(res.error?.code, '23505');
}));

async function makeOrder(c, customer, status = 'placed') {
  await asSuperuser(c);
  const { rows } = await c.query(`
    insert into public.orders (user_id, restaurant_id, location_id, status, pickup_name, subtotal_cents, service_fee_cents,
      total_cents, gst_cents, commission_rate_bps, commission_cents, restaurant_net_cents, pricing_version)
    values ($1, ${id('r-valley-smash')}, ${id('l-valley-smash')}, $2, 'Sam', 1690, 99, 1789, 163, 1000, 169, 1521, 'test')
    returning id`, [customer, status]);
  return rows[0].id;
}

test('customers cannot create or modify orders directly', () => tx(async (c) => {
  const cust = await createUser(c, 'buyer@example.com');
  const oid = await makeOrder(c, cust);
  await as(c, cust);
  let res = await expectDenied(c, `insert into public.orders (user_id, restaurant_id, location_id, pickup_name, subtotal_cents, total_cents, commission_rate_bps, commission_cents, restaurant_net_cents, pricing_version)
    values ($1, ${id('r-valley-smash')}, ${id('l-valley-smash')}, 'x', 0, 0, 0, 0, 0, 'x')`, [cust]);
  assert.ok(res.error);
  res = await expectDenied(c, `update public.orders set status = 'completed' where id = $1`, [oid]);
  assert.ok(res.error || res.rowCount === 0);
  // But can read their own order
  assert.equal((await c.query('select 1 from public.orders where id = $1', [oid])).rowCount, 1);
  // Another customer cannot
  const other = await createUser(c, 'other@example.com');
  await as(c, other);
  assert.equal((await c.query('select 1 from public.orders where id = $1', [oid])).rowCount, 0);
}));

test('merchant acceptance follows the order state machine', () => tx(async (c) => {
  const cust = await createUser(c, 'sm@example.com');
  const oid = await makeOrder(c, cust);
  const owner = (await c.query(`select ${id('user-demo-owner')} as u`)).rows[0].u;

  // Non-member cannot change status
  await as(c, cust);
  let res = await expectDenied(c, `select public.restaurant_update_order_status($1, 'accepted')`, [oid]);
  assert.equal(res.error?.code, '42501');

  await as(c, owner);
  res = await expectDenied(c, `select public.restaurant_update_order_status($1, 'completed')`, [oid]);
  assert.match(res.error?.message ?? '', /Invalid order status transition/);
  res = await expectDenied(c, `select public.restaurant_update_order_status($1, 'rejected')`, [oid]);
  assert.match(res.error?.message ?? '', /reason is required/);
  res = await expectDenied(c, `select public.restaurant_update_order_status($1, 'placed')`, [oid]);
  assert.ok(res.error, 'restaurants cannot mark orders paid');

  for (const s of ['accepted', 'preparing', 'ready', 'completed']) {
    await c.query(`select public.restaurant_update_order_status($1, $2::public.order_status)`, [oid, s]);
  }
  const o = (await c.query('select status, accepted_at, ready_at, completed_at, estimated_ready_at from public.orders where id = $1', [oid])).rows[0];
  assert.equal(o.status, 'completed');
  assert.ok(o.accepted_at && o.ready_at && o.completed_at && o.estimated_ready_at);
  const ev = await c.query('select to_status from public.order_status_events where order_id = $1 order by id', [oid]);
  assert.deepEqual(ev.rows.map((r) => r.to_status), ['accepted', 'preparing', 'ready', 'completed']);

  // Customer was notified
  await as(c, cust);
  assert.equal((await c.query(`select 1 from public.notifications where type = 'order_status'`)).rowCount, 4);
}));

test('order financial fields are immutable', () => tx(async (c) => {
  const cust = await createUser(c, 'imm@example.com');
  const oid = await makeOrder(c, cust);
  await asSuperuser(c);
  const res = await expectDenied(c, 'update public.orders set commission_cents = 0, restaurant_net_cents = 1690 where id = $1', [oid]);
  assert.match(res.error?.message ?? '', /immutable/);
}));

test('Reset My Taste Profile deletes behavioural signals but keeps orders', () => tx(async (c) => {
  const u = await createUser(c, 'reset@example.com');
  const oid = await makeOrder(c, u, 'placed');
  await asSuperuser(c);
  await c.query(`insert into public.user_feature_affinities (user_id, feature, score) values ($1, 'cuisine:japanese', 3.5)`, [u]);
  await as(c, u);
  await c.query(`insert into public.swipe_events (user_id, video_id, direction) values ($1, ${id('video-v3')}, 'right')`, [u]);
  await c.query(`insert into public.video_interactions (user_id, video_id, event_type) values ($1, ${id('video-v3')}, 'impression')`, [u]);
  await c.query(`insert into public.saved_meals (user_id, video_id, collection) values ($1, ${id('video-v3')}, 'cravings')`, [u]);

  // Users cannot fake the reset timestamp directly
  const res = await expectDenied(c, 'update public.profiles set taste_reset_at = now() where id = $1', [u]);
  assert.ok(res.error);

  const out = (await c.query('select public.reset_taste_profile() as r')).rows[0].r;
  assert.equal(out.swipes_deleted, 1);
  assert.equal(out.interactions_deleted, 1);
  assert.equal(out.affinities_deleted, 1);
  assert.equal((await c.query('select 1 from public.swipe_events')).rowCount, 0);
  assert.equal((await c.query('select 1 from public.user_feature_affinities')).rowCount, 0);
  assert.equal((await c.query('select 1 from public.saved_meals')).rowCount, 1, 'cravings kept unless requested');
  assert.equal((await c.query('select 1 from public.orders where id = $1', [oid])).rowCount, 1, 'orders retained');
  assert.ok((await c.query('select taste_reset_at from public.profiles where id = $1', [u])).rows[0].taste_reset_at);

  await c.query('select public.reset_taste_profile(true, true)');
  assert.equal((await c.query('select 1 from public.saved_meals')).rowCount, 0);
}));

test('account deletion request hides the public profile and is idempotent', () => tx(async (c) => {
  const u = await createUser(c, 'bye@example.com', { display_name: 'Bye' });
  await as(c, u);
  const r1 = (await c.query('select public.request_account_deletion() as id')).rows[0].id;
  const r2 = (await c.query('select public.request_account_deletion() as id')).rows[0].id;
  assert.equal(r1, r2);
  assert.equal((await c.query('select 1 from public.public_profiles where id = $1', [u])).rowCount, 0);
}));

test('opening hours handle overnight periods in Brisbane time', () => tx(async (c) => {
  const q = (ts) => c.query(`select public.location_is_open(${id('l-valley-smash')}, $1::timestamptz) as open`, [ts]);
  // 2026-11-07 is a Saturday. 01:00 Saturday Brisbane = Friday's late session (Fri 10:00–02:00).
  assert.equal((await q('2026-11-07T01:00:00+10:00')).rows[0].open, true);
  assert.equal((await q('2026-11-07T03:00:00+10:00')).rows[0].open, false);
  // 2026-11-03 is a Tuesday: Monday closes 22:00, so 01:00 Tuesday is closed.
  assert.equal((await q('2026-11-03T01:00:00+10:00')).rows[0].open, false);
  assert.equal((await q('2026-11-03T12:00:00+10:00')).rows[0].open, true);
  assert.equal((await q('2026-11-03T09:59:00+10:00')).rows[0].open, false);
}));

test('orderability requires verified restaurant, available item, open location', () => tx(async (c) => {
  const at = `'2026-11-03T12:00:00+10:00'::timestamptz`;
  const q = (item, loc) => c.query(`select public.menu_item_orderable(${id(item)}, ${id(loc)}, ${at}) as ok`);
  assert.equal((await q('i-smash-classic', 'l-valley-smash')).rows[0].ok, true);
  assert.equal((await q('i-pho-beef', 'l-pending-pho')).rows[0].ok, false, 'unverified restaurant');
  assert.equal((await q('i-smash-classic', 'l-kurilpa-sushi')).rows[0].ok, false, 'wrong location');
  await c.query(`update public.menu_items set is_available = false where id = ${id('i-smash-classic')}`);
  assert.equal((await q('i-smash-classic', 'l-valley-smash')).rows[0].ok, false, 'unavailable item');
  await c.query(`update public.restaurant_locations set is_accepting_orders = false where id = ${id('l-kurilpa-sushi')}`);
  assert.equal((await q('i-sushi-don', 'l-kurilpa-sushi')).rows[0].ok, false, 'paused location');
}));

test('staff can toggle availability via RPC but not edit prices', () => tx(async (c) => {
  const staff = await createUser(c, 'staff@example.com');
  await asSuperuser(c);
  await c.query(`insert into public.restaurant_members (restaurant_id, user_id, role) values (${id('r-valley-smash')}, $1, 'staff')`, [staff]);
  await as(c, staff);
  await c.query(`select public.set_menu_item_availability(${id('i-smash-fries')}, false)`);
  const res = await expectDenied(c, `update public.menu_items set price_cents = 1 where id = ${id('i-smash-fries')}`);
  assert.equal(res.rowCount ?? 0, 0);
  await asSuperuser(c);
  const r = await c.query(`select price_cents, is_available from public.menu_items where id = ${id('i-smash-fries')}`);
  assert.equal(r.rows[0].price_cents, 990);
  assert.equal(r.rows[0].is_available, false);
}));

test('platform settings and fraud flags are admin-only', () => tx(async (c) => {
  const u = await createUser(c, 'nosy@example.com');
  await as(c, u);
  assert.equal((await c.query('select 1 from public.platform_settings')).rowCount, 0);
  assert.equal((await c.query('select 1 from public.fraud_flags')).rowCount, 0);
  assert.equal((await c.query('select 1 from public.audit_log')).rowCount, 0);
}));

test('storage: users cannot upload into another user\'s folder', () => tx(async (c) => {
  const a = await createUser(c, 'st-a@example.com');
  const b = await createUser(c, 'st-b@example.com');
  await as(c, a);
  await c.query(`insert into storage.objects (bucket_id, name) values ('video-uploads', $1)`, [`${a}/clip.mp4`]);
  const res = await expectDenied(c, `insert into storage.objects (bucket_id, name) values ('video-uploads', $1)`, [`${b}/clip.mp4`]);
  assert.ok(res.error);
}));

test('content reports: anyone signed in can report; only admins see all', () => tx(async (c) => {
  const a = await createUser(c, 'rep-a@example.com');
  const b = await createUser(c, 'rep-b@example.com');
  await as(c, a);
  await c.query(`insert into public.content_reports (reporter_id, target_type, target_id, reason) values ($1, 'video', ${id('video-v1')}, 'misleading')`, [a]);
  await as(c, b);
  assert.equal((await c.query('select 1 from public.content_reports')).rowCount, 0);
}));

test('database order state machine matches @crave/core ORDER_TRANSITIONS exactly', async () => {
  const { ORDER_TRANSITIONS, ORDER_STATUSES } = await import('../../packages/core/src/orders.ts');
  const { rows } = await pool.query(`
    select f::text as "from", t::text as "to"
    from unnest(enum_range(null::public.order_status)) f, unnest(enum_range(null::public.order_status)) t
    where public.order_transition_allowed(f, t) order by 1, 2`);
  const fromDb = rows.map((r) => `${r.from}->${r.to}`).sort();
  const fromCore = ORDER_STATUSES.flatMap((f) => ORDER_TRANSITIONS[f].map((t) => `${f}->${t}`)).sort();
  assert.deepEqual(fromDb, fromCore);
});

test('feed_candidates: only verified, in-area restaurants; orderability computed server-side', () => tx(async (c) => {
  const u = await createUser(c, 'feed@example.com');
  await as(c, u);
  const all = await c.query(`select * from public.feed_candidates(${id('city-brisbane')}, -27.4698, 153.0251, 30, 100)`);
  assert.equal(all.rowCount, 16, 'all published demo videos');
  assert.ok(all.rows.every((r) => r.restaurant_name && !r.restaurant_name.includes('pending')));
  const v1 = all.rows.find((r) => r.video_id === all.rows.find((x) => x.menu_item_name === 'Classic Double Smash').video_id);
  assert.equal(v1.halal_certified, true);
  assert.equal(v1.price_cents, 1690);
  assert.ok(v1.distance_km > 0 && v1.distance_km < 5);
  // v13 has an approved primary link (wrap) and a pending secondary link; the approved one is used.
  const v13 = all.rows.find((r) => r.caption.startsWith('Loaded shawarma'));
  assert.equal(v13.menu_item_name, 'Loaded Chicken Shawarma Wrap');

  // Distance filter: from Sunnybank with 3 km radius only Sunnybank Dumpling House videos remain.
  const near = await c.query(`select distinct restaurant_name from public.feed_candidates(null, -27.58, 153.06, 3, 100)`);
  assert.deepEqual(near.rows.map((r) => r.restaurant_name), ['Sunnybank Dumpling House']);

  // Unavailable item => video still shown, but not orderable.
  await asSuperuser(c);
  await c.query(`update public.menu_items set is_available = false where id = ${id('i-smash-classic')}`);
  await as(c, u);
  const after = await c.query(`select orderable, item_available from public.feed_candidates() where menu_item_id = ${id('i-smash-classic')}`);
  assert.equal(after.rows[0].orderable, false);
  assert.equal(after.rows[0].item_available, false);
}));

test('bump_video_stats is backend-only', () => tx(async (c) => {
  const u = await createUser(c, 'stats@example.com');
  await as(c, u);
  const res = await expectDenied(c, `select public.bump_video_stats(${id('video-v1')}, 1000000)`);
  assert.equal(res.error?.code, '42501');
  await asSuperuser(c);
  await c.query(`select public.bump_video_stats(${id('video-v1')}, p_impressions => 2, p_right_swipes => 1)`);
  await c.query(`select public.bump_video_stats(${id('video-v1')}, p_right_swipes => -5)`);
  const s = (await c.query(`select impressions, right_swipes from public.video_stats where video_id = ${id('video-v1')}`)).rows[0];
  assert.equal(Number(s.impressions), 2);
  assert.equal(Number(s.right_swipes), 0, 'never negative');
}));

test('user_ranking_signals: own signals only, enriched with item features, respects reset', () => tx(async (c) => {
  const u = await createUser(c, 'signals@example.com');
  const other = await createUser(c, 'signals2@example.com');
  await as(c, u);
  await c.query(`insert into public.swipe_events (user_id, video_id, direction) values ($1, ${id('video-v3')}, 'right')`, [u]);
  await c.query(`insert into public.video_interactions (user_id, video_id, event_type, watch_ms, completion_pct) values ($1, ${id('video-v1')}, 'watch', 800, 5)`, [u]);
  await c.query(`insert into public.video_interactions (user_id, video_id, event_type) values ($1, ${id('video-v1')}, 'impression')`, [u]);
  await c.query(`insert into public.video_likes (user_id, video_id) values ($1, ${id('video-v12')})`, [u]);
  const oid = await makeOrder(c, u, 'placed');
  await asSuperuser(c);
  await c.query(`insert into public.order_items (order_id, menu_item_id, name, unit_price_cents, quantity, line_total_cents) values ($1, ${id('i-smash-classic')}, 'Classic', 1690, 1, 1690)`, [oid]);
  await as(c, u);

  const { rows } = await c.query('select * from public.user_ranking_signals($1)', [u]);
  const kinds = rows.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['like', 'order', 'right_swipe', 'watch'], 'impressions are not ranking signals');
  const swipe = rows.find((r) => r.kind === 'right_swipe');
  assert.equal(swipe.cuisine, 'japanese');
  assert.equal(swipe.category, 'sushi');
  const like = rows.find((r) => r.kind === 'like');
  assert.equal(like.halal_certified, true, 'Gabba Charcoal is halal certified (demo)');
  assert.equal(rows.find((r) => r.kind === 'order').price_cents, 1690);

  const denied = await expectDenied(c, 'select * from public.user_ranking_signals($1)', [other]);
  assert.equal(denied.error?.code, '42501');

  await c.query('select public.reset_taste_profile()');
  const after = await c.query('select kind from public.user_ranking_signals($1)', [u]);
  assert.deepEqual(after.rows.map((r) => r.kind), [], 'order kept but ignored after reset; likes before reset ignored');
}));

test('nearby_restaurants: verified only, distance-ordered, searchable by dish, cuisine, suburb', () => tx(async (c) => {
  await as(c, 'anon');
  const all = await c.query(`select name, distance_km from public.nearby_restaurants(-27.4575, 153.0355, 50, null, 50)`);
  assert.equal(all.rowCount, 8);
  assert.equal(all.rows[0].name, 'Valley Smash Burgers', 'closest first');
  assert.ok(!all.rows.some((r) => r.name.includes('pending')));

  const sushi = await c.query(`select name, matched_items from public.nearby_restaurants(null, null, 50, 'sushi', 50)`);
  assert.deepEqual(sushi.rows.map((r) => r.name), ['Kurilpa Sushi Bar']);
  const tacos = await c.query(`select name, matched_items from public.nearby_restaurants(null, null, 50, 'birria', 50)`);
  assert.deepEqual(tacos.rows[0].matched_items, ['Birria Tacos with Consommé (3)']);
  const suburb = await c.query(`select name from public.nearby_restaurants(null, null, 50, 'sunnybank', 50)`);
  assert.deepEqual(suburb.rows.map((r) => r.name), ['Sunnybank Dumpling House']);
  const injection = await c.query(`select count(*)::int n from public.nearby_restaurants(null, null, 50, $1, 50)`, ["%' or 1=1 --"]);
  assert.equal(injection.rows[0].n, 0);
}));

test('restaurant_video_menu: photo fallback for items without video; hides unverified restaurants', () => tx(async (c) => {
  await as(c, 'anon');
  const menu = await c.query(`select name, video_id, has_options from public.restaurant_video_menu(${id('r-valley-smash')})`);
  const byName = Object.fromEntries(menu.rows.map((r) => [r.name, r]));
  assert.ok(byName['Classic Double Smash'].video_id, 'has a video');
  assert.equal(byName['Classic Double Smash'].has_options, true);
  assert.equal(byName['Loaded Fries'].video_id, null, 'no video -> photo menu');
  const pending = await c.query(`select * from public.restaurant_video_menu(${id('r-pending-pho')})`);
  assert.equal(pending.rowCount, 0);
}));

test('restaurant_tag_requests: members only', () => tx(async (c) => {
  const u = await createUser(c, 'tags@example.com');
  await as(c, u);
  const denied = await expectDenied(c, `select * from public.restaurant_tag_requests(${id('r-gabba-charcoal')})`);
  assert.equal(denied.error?.code, '42501');
  await asSuperuser(c);
  await c.query(`insert into public.restaurant_members (restaurant_id, user_id, role) values (${id('r-gabba-charcoal')}, $1, 'manager')`, [u]);
  await as(c, u);
  const rows = (await c.query(`select status, creator_handle from public.restaurant_tag_requests(${id('r-gabba-charcoal')})`)).rows;
  assert.equal(rows[0].status, 'pending', 'pending requests first');
  assert.ok(rows.some((r) => r.status === 'approved'));
}));

test('restaurant onboarding flow (as the web dashboard performs it) works under RLS', () => tx(async (c) => {
  const owner = await createUser(c, 'newowner@example.com');
  await as(c, owner);
  const city = (await c.query(`select id from public.cities where name = 'Brisbane'`)).rows[0].id;
  const rid = (await c.query(`insert into public.restaurants (name, slug, legal_name, abn, cuisines, price_level, created_by)
    values ('New Cafe', 'new-cafe', 'New Cafe Pty Ltd', '51824753556', '{italian}', 2, $1) returning id`, [owner])).rows[0].id;
  const loc = (await c.query(`insert into public.restaurant_locations (restaurant_id, city_id, address_line1, suburb, region, postcode, lat, lng)
    values ($1, $2, '1 Test St', 'Milton', 'QLD', '4064', -27.47, 153.003) returning id`, [rid, city])).rows[0].id;
  await c.query(`insert into public.location_opening_hours (location_id, day_of_week, opens_at, closes_at) select $1, d, '11:00', '21:00' from generate_series(0,6) d`, [loc]);
  await c.query(`insert into public.menus (restaurant_id, name) values ($1, 'Main menu')`, [rid]);
  const item = (await c.query(`insert into public.menu_items (restaurant_id, name, price_cents, dietary_tags) values ($1, 'Gnocchi', 2600, '{vegetarian}') returning id`, [rid])).rows[0].id;
  const g = (await c.query(`insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select) values ($1, 'Size', 1, 1) returning id`, [item])).rows[0].id;
  await c.query(`insert into public.menu_item_options (group_id, name, price_delta_cents) values ($1, 'Large', 400)`, [g]);
  await c.query(`insert into storage.objects (bucket_id, name) values ('verification-docs', $1)`, [`${rid}/licence.pdf`]);
  await c.query(`insert into storage.objects (bucket_id, name) values ('menu-images', $1)`, [`${rid}/${item}.jpg`]);
  await c.query(`insert into public.restaurant_verifications (restaurant_id, submitted_by, document_paths, food_business_licence_number) values ($1, $2, $3, 'BCC-123')`, [rid, owner, [`${rid}/licence.pdf`]]);
  await c.query(`update public.restaurants set status = 'pending_verification' where id = $1`, [rid]);

  // Still invisible to customers and not in discovery.
  const customer = await createUser(c, 'cust2@example.com');
  await as(c, customer);
  assert.equal((await c.query(`select 1 from public.nearby_restaurants(null, null, 50, 'new cafe', 10)`)).rowCount, 0);
  const res = await expectDenied(c, `insert into storage.objects (bucket_id, name) values ('menu-images', $1)`, [`${rid}/hack.jpg`]);
  assert.ok(res.error, 'non-members cannot upload menu images');

  // Admin approves -> visible.
  const admin = await createUser(c, 'admin3@example.com');
  await asSuperuser(c);
  await c.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [admin]);
  await as(c, admin);
  const vid = (await c.query('select id from public.restaurant_verifications where restaurant_id = $1', [rid])).rows[0].id;
  await c.query('select public.admin_decide_verification($1, true, null)', [vid]);
  await as(c, customer);
  assert.equal((await c.query(`select 1 from public.nearby_restaurants(null, null, 50, 'gnocchi', 10)`)).rowCount, 1);
}));

test('creator upload flow (as the mobile app performs it) ends pending review with a pending tag', () => tx(async (c) => {
  const u = await createUser(c, 'uploader@example.com');
  await as(c, u);
  await c.query(`insert into public.creators (user_id, handle) values ($1, 'newcreator')`, [u]);
  const v = (await c.query(`insert into public.videos (uploader_id, source, caption, hashtags, duration_ms, is_sponsored, sponsor_disclosure)
    values ($1, 'customer', 'Great dumplings #dumplings', '{dumplings}', 20000, true, 'Paid partnership with Sunnybank Dumpling House') returning id, status`, [u])).rows[0];
  assert.equal(v.status, 'uploading');
  await c.query(`insert into storage.objects (bucket_id, name) values ('video-uploads', $1)`, [`${u}/${v.id}.mp4`]);
  await c.query(`update public.videos set storage_path = $2, status = 'pending_review', rights_attested_at = now() where id = $1`, [v.id, `${u}/${v.id}.mp4`]);
  await c.query(`insert into public.video_menu_items (video_id, menu_item_id, restaurant_id) values ($1, ${id('i-dump-xlb')}, ${id('r-sunnybank-dumpling')})`, [v.id]);
  const tag = (await c.query('select status from public.video_menu_items where video_id = $1', [v.id])).rows[0];
  assert.equal(tag.status, 'pending');
  // Sponsored without disclosure is rejected by the database.
  const bad = await expectDenied(c, `insert into public.videos (uploader_id, is_sponsored) values ($1, true)`, [u]);
  assert.ok(bad.error);
  // Not in anyone's feed until published.
  assert.equal((await c.query('select 1 from public.feed_candidates() where video_id = $1', [v.id])).rowCount, 0);
}));
