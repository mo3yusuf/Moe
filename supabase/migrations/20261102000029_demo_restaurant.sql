-- "Create sample restaurant" (admin tool): a complete, approved demo restaurant owned by the admin who
-- creates it — CRAVE Demo Kitchen, with a location, opening hours, a full menu and Uber Eats-style
-- options (sides, a nested sauce choice, extras with quantities, remove-ingredient chips, a meal deal).
-- Used to test and demo the whole flow: post a video tagged with a dish → swipe right → order.
-- Running it again returns the same restaurant. No photos or Stripe account are created: the owner
-- adds photos in Menu and connects (test) payouts in Payouts.

create or replace function public.admin_create_demo_restaurant()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_city uuid;
  v_rest uuid;
  v_loc uuid;
  v_menu uuid;
  v_item uuid;
  v_group uuid;
  v_opt uuid;
  v_coke uuid;
  v_lls uuid;
  v_smash uuid;
  v_chicken uuid;
  v_slug text := 'crave-demo-kitchen';
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;

  select r.id into v_rest from public.restaurants r where r.slug like 'crave-demo-kitchen%' and r.created_by = v_owner order by r.created_at limit 1;
  if v_rest is not null then return v_rest; end if;

  select c.id into v_city from public.cities c where c.name = 'Brisbane' and c.region = 'QLD' limit 1;
  if v_city is null then raise exception 'Brisbane is not set up in cities' using errcode = 'P0002'; end if;
  if exists (select 1 from public.restaurants r where r.slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(v_owner::text), 1, 6);
  end if;

  insert into public.restaurants (name, slug, description, legal_name, abn, cuisines, price_level, status, created_by)
  values ('CRAVE Demo Kitchen', v_slug,
          'Smash burgers, loaded fries and thick shakes in Fortitude Valley. A sample restaurant for trying CRAVE end to end.',
          'CRAVE Demo Kitchen (sample)', null, array['american'], 2, 'verified', v_owner)
  returning id into v_rest; -- the owner membership is added by the add_restaurant_owner trigger

  insert into public.restaurant_locations (restaurant_id, city_id, label, address_line1, suburb, region, postcode, lat, lng, phone,
                                           pickup_enabled, prep_time_minutes, is_accepting_orders)
  values (v_rest, v_city, 'Fortitude Valley', '1 Example Lane', 'Fortitude Valley', 'QLD', '4006', -27.4575, 153.0355, null, true, 15, true)
  returning id into v_loc;
  -- Open all day, every day, so test orders work at any time (change in Hours).
  insert into public.location_opening_hours (location_id, day_of_week, opens_at, closes_at)
  select v_loc, d, '00:00', '23:59' from generate_series(0, 6) d;

  insert into public.menus (restaurant_id, name) values (v_rest, 'Main menu') returning id into v_menu;

  -- Drinks first (the meal deal links to them).
  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, sort_order)
  values (v_rest, v_menu, 'Drinks', 'Coke', '375 ml can, ice cold.', 450, 'american', 'drink', array['soft_drink'], 1)
  returning id into v_coke;
  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, sort_order)
  values (v_rest, v_menu, 'Drinks', 'Lemon, Lime & Bitters', 'House-made, not too sweet.', 550, 'american', 'drink', array['soft_drink'], 2)
  returning id into v_lls;
  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, allergens, sort_order)
  values (v_rest, v_menu, 'Drinks', 'Thick Shake', 'Proper thick, made with real ice cream.', 790, 'american', 'shake', array['shake', 'sweet'], array['milk'], 3)
  returning id into v_item;
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_item, 'Flavour', 1, 1, 1, 'chips') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order)
  values (v_group, 'Chocolate', 0, 1), (v_group, 'Vanilla', 0, 2), (v_group, 'Salted caramel', 50, 3), (v_group, 'Strawberry', 0, 4);

  -- Burgers.
  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, allergens, spice_level, sort_order)
  values (v_rest, v_menu, 'Burgers', 'Double Smash Burger', 'Two smashed beef patties, American cheese, pickles, onion and house sauce on a toasted brioche bun.',
          1690, 'american', 'burger', array['beef', 'cheese'], array['gluten', 'wheat', 'milk', 'egg', 'sesame'], 0, 1)
  returning id into v_smash;
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_smash, 'Choose a side', 1, 1, 1, 'list') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order) values (v_group, 'Fries', 0, 1) returning id into v_opt;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order) values (v_group, 'Side salad', 100, 2), (v_group, 'Onion rings', 200, 3);
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style, parent_option_id)
  values (v_smash, 'Fries sauce', 1, 1, 2, 'chips', v_opt) returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order)
  values (v_group, 'Aioli', 50, 1), (v_group, 'Ketchup', 0, 2), (v_group, 'Chipotle mayo', 50, 3);
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_smash, 'Extras', 0, 6, 3, 'list') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, max_quantity, sort_order)
  values (v_group, 'Extra patty', 400, 3, 1), (v_group, 'Bacon', 300, 2, 2), (v_group, 'Fried egg', 200, 1, 3), (v_group, 'Jalapeños', 100, 1, 4);
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_smash, 'Remove ingredients', 0, 4, 4, 'remove') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order)
  values (v_group, 'Onion', 0, 1), (v_group, 'Pickles', 0, 2), (v_group, 'House sauce', 0, 3), (v_group, 'Cheese', 0, 4);

  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, allergens, spice_level, sort_order)
  values (v_rest, v_menu, 'Burgers', 'Crispy Chicken Burger', 'Buttermilk fried chicken thigh, slaw and chilli mayo.',
          1590, 'american', 'burger', array['chicken', 'fried', 'spicy'], array['gluten', 'wheat', 'milk', 'egg'], 2, 2)
  returning id into v_chicken;
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_chicken, 'Heat', 1, 1, 1, 'chips') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order)
  values (v_group, 'Mild', 0, 1), (v_group, 'Hot', 0, 2), (v_group, 'Extra hot', 0, 3);
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_chicken, 'Remove ingredients', 0, 2, 2, 'remove') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order) values (v_group, 'Slaw', 0, 1), (v_group, 'Chilli mayo', 0, 2);

  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, dietary_tags, allergens, sort_order)
  values (v_rest, v_menu, 'Burgers', 'Smoky Mushroom Burger', 'Grilled portobello, smoked cheddar, rocket and truffle mayo.',
          1490, 'american', 'burger', array['mushroom'], array['vegetarian'], array['gluten', 'wheat', 'milk', 'egg'], 3);

  -- Sides and dessert.
  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, allergens, sort_order)
  values (v_rest, v_menu, 'Sides', 'Loaded Fries', 'Fries with cheese sauce, crispy shallots and house sauce.', 990, 'american', 'fries', array['cheese', 'fried'], array['milk', 'egg'], 1)
  returning id into v_item;
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_item, 'Add', 0, 2, 1, 'list') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order) values (v_group, 'Bacon bits', 300, 1), (v_group, 'Jalapeños', 100, 2);
  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, dietary_tags, sort_order)
  values (v_rest, v_menu, 'Sides', 'Fries', 'Crispy, salted.', 590, 'american', 'fries', array['fried'], array['vegetarian', 'vegan'], 2);
  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, allergens, sort_order)
  values (v_rest, v_menu, 'Desserts', 'Biscoff Cheesecake', 'Baked cheesecake on a Biscoff crumb.', 890, 'desserts', 'cheesecake', array['sweet'], array['gluten', 'wheat', 'milk', 'egg'], 1);

  -- Meal deal (combo): burger + side + drink.
  insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, allergens, is_combo, sort_order)
  values (v_rest, v_menu, 'Meal deals', 'Smash Meal Deal', 'Any burger, fries and a drink.', 2290, 'american', 'burger', array['beef', 'meal_deal'], array['gluten', 'wheat', 'milk', 'egg', 'sesame'], true, 1)
  returning id into v_item;
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_item, 'Burger', 1, 1, 1, 'list') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order, linked_menu_item_id)
  values (v_group, 'Double Smash Burger', 0, 1, v_smash), (v_group, 'Crispy Chicken Burger', 0, 2, v_chicken);
  insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style)
  values (v_item, 'Drink', 1, 1, 2, 'list') returning id into v_group;
  insert into public.menu_item_options (group_id, name, price_delta_cents, sort_order, linked_menu_item_id)
  values (v_group, 'Coke', 0, 1, v_coke), (v_group, 'Lemon, Lime & Bitters', 100, 2, v_lls);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (v_owner, 'demo_restaurant_created', 'restaurant', v_rest::text, jsonb_build_object('slug', v_slug));
  return v_rest;
end $$;
revoke all on function public.admin_create_demo_restaurant() from public, anon;
grant execute on function public.admin_create_demo_restaurant() to authenticated;
