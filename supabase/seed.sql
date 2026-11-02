-- CRAVE demonstration data — Brisbane, QLD.
-- ALL RESTAURANTS, PEOPLE, PRICES AND CERTIFICATIONS BELOW ARE FICTIONAL DEMO DATA.
-- Demo video URLs point at openly licensed sample clips (not food) purely to exercise the player;
-- replace them with CRAVE-licensed food footage before any pilot.
-- Deterministic ids: md5('<key>')::uuid.

-- Reference data -----------------------------------------------------------------
insert into public.countries (code, name, currency, tax_name, tax_rate_bps, prices_include_tax)
values ('AU', 'Australia', 'AUD', 'GST', 1000, true) on conflict do nothing;

insert into public.cities (id, country_code, name, region, timezone, is_active, centre_lat, centre_lng)
values (md5('city-brisbane')::uuid, 'AU', 'Brisbane', 'QLD', 'Australia/Brisbane', true, -27.4698, 153.0251)
on conflict do nothing;

insert into public.platform_settings (key, value, description) values
  ('default_commission_bps', '1000', 'Default restaurant commission in basis points (1000 = 10%).'),
  ('service_fee', '{"percent_bps": 0, "fixed_cents": 99, "min_cents": 99, "max_cents": 299}',
   'Customer service fee (GST-inclusive). Review with accountant/legal before launch.'),
  ('ranking_weights', '{}', 'Overrides for recommendation weights; empty = engine defaults.'),
  ('privacy_policy_version', '"2026-11-draft"', 'Current privacy policy version shown at consent.')
on conflict (key) do nothing;

-- Demo accounts (no password: they own demo content but cannot sign in).
-- Loginable demo accounts are created by scripts/create-demo-accounts.mjs via the Auth Admin API.
insert into auth.users (id, email, raw_user_meta_data) values
  (md5('user-demo-creator')::uuid, 'demo-creator@crave.invalid', '{"display_name":"Brisbane Bites (demo)"}'),
  (md5('user-demo-creator2')::uuid, 'demo-creator2@crave.invalid', '{"display_name":"Spice Hunter (demo)"}'),
  (md5('user-demo-owner')::uuid, 'demo-owner@crave.invalid', '{"display_name":"Demo Owner"}')
on conflict do nothing;

insert into public.creators (user_id, handle, bio, is_verified) values
  (md5('user-demo-creator')::uuid, 'brisbanebites', 'Demo creator: honest food reviews around Brisbane.', true),
  (md5('user-demo-creator2')::uuid, 'spicehunter', 'Demo creator: chasing the hottest dishes in SEQ.', false)
on conflict do nothing;
insert into public.user_roles (user_id, role) values
  (md5('user-demo-creator')::uuid, 'creator'), (md5('user-demo-creator2')::uuid, 'creator')
on conflict do nothing;

-- Restaurants ------------------------------------------------------------------------
insert into public.restaurants (id, name, slug, description, abn, cuisines, price_level, status, accepts_advance_orders, created_by) values
  (md5('r-valley-smash')::uuid, 'Valley Smash Burgers', 'valley-smash-burgers', 'Smashed patties, toasted milk buns, late nights in the Valley.', '00000000001', '{american,burgers}', 2, 'verified', true, md5('user-demo-owner')::uuid),
  (md5('r-kurilpa-sushi')::uuid, 'Kurilpa Sushi Bar', 'kurilpa-sushi-bar', 'Nigiri, hand rolls and donburi by the river.', '00000000002', '{japanese,sushi}', 3, 'verified', false, md5('user-demo-owner')::uuid),
  (md5('r-paddo-pasta')::uuid, 'Paddington Pasta Co', 'paddington-pasta-co', 'Fresh pasta made every morning.', '00000000003', '{italian}', 2, 'verified', false, null),
  (md5('r-westend-taqueria')::uuid, 'West End Taqueria', 'west-end-taqueria', 'Corn tortillas pressed to order.', '00000000004', '{mexican}', 2, 'verified', false, null),
  (md5('r-sunnybank-dumpling')::uuid, 'Sunnybank Dumpling House', 'sunnybank-dumpling-house', 'Hand-folded dumplings and noodle soups.', '00000000005', '{chinese}', 1, 'verified', false, null),
  (md5('r-newfarm-thai')::uuid, 'New Farm Thai Kitchen', 'new-farm-thai-kitchen', 'Bright, punchy Thai street food.', '00000000006', '{thai}', 2, 'verified', false, null),
  (md5('r-gabba-charcoal')::uuid, 'Gabba Charcoal Chicken', 'gabba-charcoal-chicken', 'Charcoal chicken, garlic sauce, loaded wraps.', '00000000007', '{lebanese,chicken}', 2, 'verified', false, null),
  (md5('r-bulimba-sweet')::uuid, 'Bulimba Sweet Lab', 'bulimba-sweet-lab', 'Soft serve, bombolini and seasonal desserts.', '00000000008', '{desserts}', 1, 'verified', false, null),
  (md5('r-pending-pho')::uuid, 'Inala Pho Corner (pending)', 'inala-pho-corner', 'Awaiting verification — must not appear to customers.', '00000000009', '{vietnamese}', 1, 'pending_verification', false, null)
on conflict do nothing;

insert into public.restaurant_certifications (restaurant_id, certification, certifier_name, verified_at) values
  (md5('r-valley-smash')::uuid, 'halal', 'Demo Halal Certifier (fictional)', now()),
  (md5('r-gabba-charcoal')::uuid, 'halal', 'Demo Halal Certifier (fictional)', now())
on conflict do nothing;

insert into public.restaurant_locations (id, restaurant_id, city_id, label, address_line1, suburb, region, postcode, lat, lng, prep_time_minutes) values
  (md5('l-valley-smash')::uuid, md5('r-valley-smash')::uuid, md5('city-brisbane')::uuid, 'Fortitude Valley', '1 Demo Lane', 'Fortitude Valley', 'QLD', '4006', -27.4575, 153.0355, 12),
  (md5('l-kurilpa-sushi')::uuid, md5('r-kurilpa-sushi')::uuid, md5('city-brisbane')::uuid, 'South Brisbane', '2 Demo Street', 'South Brisbane', 'QLD', '4101', -27.4778, 153.0174, 15),
  (md5('l-paddo-pasta')::uuid, md5('r-paddo-pasta')::uuid, md5('city-brisbane')::uuid, 'Paddington', '3 Demo Terrace', 'Paddington', 'QLD', '4064', -27.4600, 153.0050, 20),
  (md5('l-westend-taqueria')::uuid, md5('r-westend-taqueria')::uuid, md5('city-brisbane')::uuid, 'West End', '4 Demo Road', 'West End', 'QLD', '4101', -27.4820, 153.0090, 10),
  (md5('l-sunnybank-dumpling')::uuid, md5('r-sunnybank-dumpling')::uuid, md5('city-brisbane')::uuid, 'Sunnybank', '5 Demo Avenue', 'Sunnybank', 'QLD', '4109', -27.5800, 153.0600, 15),
  (md5('l-newfarm-thai')::uuid, md5('r-newfarm-thai')::uuid, md5('city-brisbane')::uuid, 'New Farm', '6 Demo Street', 'New Farm', 'QLD', '4005', -27.4670, 153.0450, 15),
  (md5('l-gabba-charcoal')::uuid, md5('r-gabba-charcoal')::uuid, md5('city-brisbane')::uuid, 'Woolloongabba', '7 Demo Road', 'Woolloongabba', 'QLD', '4102', -27.4880, 153.0360, 10),
  (md5('l-bulimba-sweet')::uuid, md5('r-bulimba-sweet')::uuid, md5('city-brisbane')::uuid, 'Bulimba', '8 Demo Parade', 'Bulimba', 'QLD', '4171', -27.4520, 153.0590, 5),
  (md5('l-pending-pho')::uuid, md5('r-pending-pho')::uuid, md5('city-brisbane')::uuid, 'Inala', '9 Demo Close', 'Inala', 'QLD', '4077', -27.5900, 152.9750, 10)
on conflict do nothing;

-- Opening hours: every location 10:00–22:00 daily; Valley Smash also open late (to 02:00) Fri & Sat.
insert into public.location_opening_hours (location_id, day_of_week, opens_at, closes_at)
select l.id, d, '10:00', case when l.id = md5('l-valley-smash')::uuid and d in (5, 6) then '02:00'::time else '22:00'::time end
from public.restaurant_locations l cross join generate_series(0, 6) d
on conflict do nothing;

insert into public.menus (id, restaurant_id, name)
select md5('m-' || r.slug)::uuid, r.id, 'Main menu' from public.restaurants r on conflict do nothing;

-- Menu items (price_cents are GST-inclusive demo prices).
insert into public.menu_items (id, restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, dietary_tags, spice_level) values
  (md5('i-smash-classic')::uuid, md5('r-valley-smash')::uuid, md5('m-valley-smash-burgers')::uuid, 'Burgers', 'Classic Double Smash', 'Two smashed beef patties, American cheese, pickles, house sauce.', 1690, 'american', 'burger', '{beef,cheese,smashed}', '{halal}', 0),
  (md5('i-smash-chilli')::uuid, md5('r-valley-smash')::uuid, md5('m-valley-smash-burgers')::uuid, 'Burgers', 'Chilli Crunch Chicken Burger', 'Fried chicken thigh, chilli crunch mayo, slaw.', 1790, 'american', 'burger', '{chicken,fried,spicy}', '{halal}', 3),
  (md5('i-smash-fries')::uuid, md5('r-valley-smash')::uuid, md5('m-valley-smash-burgers')::uuid, 'Sides', 'Loaded Fries', 'Fries, cheese sauce, crispy onion.', 990, 'american', 'sides', '{fries,cheese}', '{vegetarian,halal}', 0),
  (md5('i-sushi-salmon')::uuid, md5('r-kurilpa-sushi')::uuid, md5('m-kurilpa-sushi-bar')::uuid, 'Nigiri', 'Aburi Salmon Nigiri (6pc)', 'Flame-seared salmon, miso glaze.', 2200, 'japanese', 'sushi', '{salmon,seafood,raw_fish}', '{dairy_free}', 0),
  (md5('i-sushi-handroll')::uuid, md5('r-kurilpa-sushi')::uuid, md5('m-kurilpa-sushi-bar')::uuid, 'Hand rolls', 'Spicy Tuna Hand Roll', 'Tuna, chilli mayo, cucumber, crisp nori.', 1150, 'japanese', 'sushi', '{tuna,seafood,spicy}', '{}', 2),
  (md5('i-sushi-don')::uuid, md5('r-kurilpa-sushi')::uuid, md5('m-kurilpa-sushi-bar')::uuid, 'Donburi', 'Teriyaki Chicken Don', 'Grilled chicken, teriyaki, rice, pickles.', 1900, 'japanese', 'rice_bowl', '{chicken,rice}', '{dairy_free}', 0),
  (md5('i-pasta-cacio')::uuid, md5('r-paddo-pasta')::uuid, md5('m-paddington-pasta-co')::uuid, 'Pasta', 'Cacio e Pepe', 'Tonnarelli, pecorino, black pepper.', 2400, 'italian', 'pasta', '{cheese,pasta}', '{vegetarian}', 0),
  (md5('i-pasta-ragu')::uuid, md5('r-paddo-pasta')::uuid, md5('m-paddington-pasta-co')::uuid, 'Pasta', 'Slow-cooked Beef Ragu Pappardelle', 'Eight-hour ragu, parmesan.', 2800, 'italian', 'pasta', '{beef,pasta}', '{}', 0),
  (md5('i-taco-birria')::uuid, md5('r-westend-taqueria')::uuid, md5('m-west-end-taqueria')::uuid, 'Tacos', 'Birria Tacos with Consommé (3)', 'Braised beef, melted cheese, dipping broth.', 2100, 'mexican', 'tacos', '{beef,cheese,spicy}', '{}', 2),
  (md5('i-taco-fish')::uuid, md5('r-westend-taqueria')::uuid, md5('m-west-end-taqueria')::uuid, 'Tacos', 'Baja Fish Tacos (2)', 'Beer-battered fish, cabbage, chipotle crema.', 1600, 'mexican', 'tacos', '{fish,seafood,fried}', '{}', 1),
  (md5('i-taco-veg')::uuid, md5('r-westend-taqueria')::uuid, md5('m-west-end-taqueria')::uuid, 'Tacos', 'Charred Cauliflower Tacos (2)', 'Cauliflower, salsa verde, pepitas.', 1400, 'mexican', 'tacos', '{vegetable}', '{vegan,gluten_free}', 1),
  (md5('i-dump-pork')::uuid, md5('r-sunnybank-dumpling')::uuid, md5('m-sunnybank-dumpling-house')::uuid, 'Dumplings', 'Pork & Chive Dumplings (12)', 'Pan-fried, black vinegar dip.', 1450, 'chinese', 'dumplings', '{pork,fried}', '{}', 0),
  (md5('i-dump-xlb')::uuid, md5('r-sunnybank-dumpling')::uuid, md5('m-sunnybank-dumpling-house')::uuid, 'Dumplings', 'Xiao Long Bao (8)', 'Soup dumplings, ginger vinegar.', 1380, 'chinese', 'dumplings', '{pork,steamed}', '{}', 0),
  (md5('i-dump-noodle')::uuid, md5('r-sunnybank-dumpling')::uuid, md5('m-sunnybank-dumpling-house')::uuid, 'Noodles', 'Dan Dan Noodles', 'Sesame, chilli oil, minced pork.', 1590, 'chinese', 'noodles', '{pork,noodles,spicy}', '{}', 3),
  (md5('i-thai-padsee')::uuid, md5('r-newfarm-thai')::uuid, md5('m-new-farm-thai-kitchen')::uuid, 'Wok', 'Pad See Ew Chicken', 'Wide rice noodles, gai lan, sweet soy.', 2050, 'thai', 'noodles', '{chicken,noodles,wok}', '{dairy_free}', 1),
  (md5('i-thai-curry')::uuid, md5('r-newfarm-thai')::uuid, md5('m-new-farm-thai-kitchen')::uuid, 'Curry', 'Green Curry Prawns', 'Prawns, Thai basil, eggplant, jasmine rice.', 2490, 'thai', 'curry', '{prawn,seafood,spicy,curry}', '{gluten_free,dairy_free}', 3),
  (md5('i-gabba-half')::uuid, md5('r-gabba-charcoal')::uuid, md5('m-gabba-charcoal-chicken')::uuid, 'Charcoal', 'Half Charcoal Chicken & Chips', 'Half chicken, toum, pickles, chips.', 1990, 'lebanese', 'chicken', '{chicken,grilled}', '{halal,gluten_free}', 0),
  (md5('i-gabba-wrap')::uuid, md5('r-gabba-charcoal')::uuid, md5('m-gabba-charcoal-chicken')::uuid, 'Wraps', 'Loaded Chicken Shawarma Wrap', 'Shawarma, toum, chips inside, chilli.', 1550, 'lebanese', 'wrap', '{chicken,grilled,spicy}', '{halal}', 2),
  (md5('i-sweet-bomb')::uuid, md5('r-bulimba-sweet')::uuid, md5('m-bulimba-sweet-lab')::uuid, 'Sweets', 'Pistachio Bombolini (3)', 'Filled Italian doughnuts.', 1200, 'desserts', 'dessert', '{pastry,pistachio}', '{vegetarian}', 0),
  (md5('i-sweet-softserve')::uuid, md5('r-bulimba-sweet')::uuid, md5('m-bulimba-sweet-lab')::uuid, 'Sweets', 'Burnt Honey Soft Serve', 'Cone or cup, honeycomb crumb.', 790, 'desserts', 'dessert', '{ice_cream,honey}', '{vegetarian,gluten_free}', 0),
  (md5('i-pho-beef')::uuid, md5('r-pending-pho')::uuid, md5('m-inala-pho-corner')::uuid, 'Pho', 'Beef Pho', 'Not visible until verified.', 1600, 'vietnamese', 'noodles', '{beef,soup}', '{}', 0)
on conflict do nothing;

-- Customisations
insert into public.menu_item_option_groups (id, menu_item_id, name, min_select, max_select, sort_order) values
  (md5('g-smash-extras')::uuid, md5('i-smash-classic')::uuid, 'Extras', 0, 3, 1),
  (md5('g-smash-size')::uuid, md5('i-smash-classic')::uuid, 'Patties', 1, 1, 0),
  (md5('g-gabba-sauce')::uuid, md5('i-gabba-half')::uuid, 'Sauce', 1, 1, 0)
on conflict do nothing;
insert into public.menu_item_options (id, group_id, name, price_delta_cents, sort_order) values
  (md5('o-smash-double')::uuid, md5('g-smash-size')::uuid, 'Double (standard)', 0, 0),
  (md5('o-smash-triple')::uuid, md5('g-smash-size')::uuid, 'Triple', 450, 1),
  (md5('o-smash-bacon')::uuid, md5('g-smash-extras')::uuid, 'Beef bacon', 350, 0),
  (md5('o-smash-jalapeno')::uuid, md5('g-smash-extras')::uuid, 'Jalapeños', 150, 1),
  (md5('o-smash-cheese')::uuid, md5('g-smash-extras')::uuid, 'Extra cheese', 200, 2),
  (md5('o-gabba-toum')::uuid, md5('g-gabba-sauce')::uuid, 'Toum (garlic)', 0, 0),
  (md5('o-gabba-chilli')::uuid, md5('g-gabba-sauce')::uuid, 'Chilli', 0, 1)
on conflict do nothing;

-- Videos ---------------------------------------------------------------------------------
-- Openly licensed sample clips (Blender Foundation, CC BY) used ONLY to exercise video playback.
with demo(key, uploader, source, restaurant, caption, hashtags, item, url, dur, sponsored, days_ago) as (values
  ('v1', 'user-demo-creator',  'creator',    'r-valley-smash',       'The crunchiest smash burger in the Valley? 🍔', '{burger,brisbane}', 'i-smash-classic', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', 15000, false, 1),
  ('v2', 'user-demo-owner',    'restaurant', 'r-valley-smash',       'Chilli crunch, fresh off the fryer.', '{chicken,spicy}', 'i-smash-chilli', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', 15000, false, 3),
  ('v3', 'user-demo-creator',  'creator',    'r-kurilpa-sushi',      'Aburi salmon that melts. Friday sushi sorted.', '{sushi,japanese}', 'i-sushi-salmon', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', 60000, true, 2),
  ('v4', 'user-demo-creator2', 'creator',    'r-kurilpa-sushi',      'Spicy tuna hand roll — how hot is it really?', '{sushi,spicy}', 'i-sushi-handroll', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', 15000, false, 5),
  ('v5', 'user-demo-creator',  'creator',    'r-paddo-pasta',        'Cacio e pepe tossed tableside.', '{pasta,italian}', 'i-pasta-cacio', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4', 15000, false, 4),
  ('v6', 'user-demo-creator2', 'creator',    'r-westend-taqueria',   'Birria dip test 🌮', '{tacos,mexican}', 'i-taco-birria', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', 15000, false, 1),
  ('v7', 'user-demo-creator',  'creator',    'r-westend-taqueria',   'Fish tacos on a Brisbane arvo.', '{tacos,seafood}', 'i-taco-fish', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', 15000, false, 9),
  ('v8', 'user-demo-creator',  'creator',    'r-sunnybank-dumpling', 'Soup dumpling technique 101.', '{dumplings,chinese}', 'i-dump-xlb', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', 60000, false, 2),
  ('v9', 'user-demo-creator2', 'creator',    'r-sunnybank-dumpling', 'Dan dan noodles — 3/4 chilli.', '{noodles,spicy}', 'i-dump-noodle', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', 15000, false, 6),
  ('v10','user-demo-creator',  'creator',    'r-newfarm-thai',       'Wok hei pad see ew.', '{thai,noodles}', 'i-thai-padsee', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4', 15000, false, 3),
  ('v11','user-demo-creator2', 'creator',    'r-newfarm-thai',       'Green curry prawns, properly hot.', '{thai,curry,seafood}', 'i-thai-curry', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', 15000, false, 8),
  ('v12','user-demo-creator',  'creator',    'r-gabba-charcoal',     'Charcoal chicken + toum = perfect.', '{chicken,halal}', 'i-gabba-half', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', 15000, false, 2),
  ('v13','user-demo-creator2', 'creator',    'r-gabba-charcoal',     'Loaded shawarma wrap review.', '{wrap,chicken}', 'i-gabba-wrap', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', 60000, false, 12),
  ('v14','user-demo-creator',  'creator',    'r-bulimba-sweet',      'Pistachio bombolini pull-apart.', '{dessert}', 'i-sweet-bomb', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', 15000, false, 1),
  ('v15','user-demo-creator2', 'creator',    'r-bulimba-sweet',      'Burnt honey soft serve.', '{dessert,icecream}', 'i-sweet-softserve', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4', 15000, false, 7),
  ('v16','user-demo-creator',  'creator',    'r-paddo-pasta',        'Eight-hour ragu.', '{pasta,beef}', 'i-pasta-ragu', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', 15000, false, 10)
)
insert into public.videos (id, uploader_id, source, restaurant_id, playback_url, duration_ms, caption, hashtags, status,
                           is_sponsored, sponsor_disclosure, rights_attested_at, created_at, published_at)
select md5('video-' || key)::uuid, md5(uploader)::uuid, source::public.video_source, md5(restaurant)::uuid, url, dur,
       caption || ' [DEMO]', hashtags::text[], 'published',
       sponsored, case when sponsored then 'Paid partnership with Kurilpa Sushi Bar (demo)' end,
       now() - make_interval(days => days_ago), now() - make_interval(days => days_ago), now() - make_interval(days => days_ago)
from demo
on conflict do nothing;

insert into public.video_menu_items (video_id, menu_item_id, restaurant_id, status, decided_at)
select v.id, mi.id, mi.restaurant_id, 'approved', now()
from (values ('v1','i-smash-classic'),('v2','i-smash-chilli'),('v3','i-sushi-salmon'),('v4','i-sushi-handroll'),
             ('v5','i-pasta-cacio'),('v6','i-taco-birria'),('v7','i-taco-fish'),('v8','i-dump-xlb'),('v9','i-dump-noodle'),
             ('v10','i-thai-padsee'),('v11','i-thai-curry'),('v12','i-gabba-half'),('v13','i-gabba-wrap'),
             ('v14','i-sweet-bomb'),('v15','i-sweet-softserve'),('v16','i-pasta-ragu')) as t(vk, ik)
join public.videos v on v.id = md5('video-' || t.vk)::uuid
join public.menu_items mi on mi.id = md5(t.ik)::uuid
on conflict do nothing;

-- One creator tag still awaiting restaurant approval (not orderable from the video yet).
insert into public.video_menu_items (video_id, menu_item_id, restaurant_id, status, is_primary)
values (md5('video-v13')::uuid, md5('i-gabba-half')::uuid, md5('r-gabba-charcoal')::uuid, 'pending', false)
on conflict do nothing;

-- Demo restaurant owner manages two demo restaurants.
insert into public.restaurant_members (restaurant_id, user_id, role) values
  (md5('r-valley-smash')::uuid, md5('user-demo-owner')::uuid, 'owner'),
  (md5('r-kurilpa-sushi')::uuid, md5('user-demo-owner')::uuid, 'owner')
on conflict do nothing;
