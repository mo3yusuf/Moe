-- "Create sample restaurants" (admin tool): five complete, approved sample restaurants owned by the
-- admin — CRAVE Demo Kitchen (burgers, from migration 029) plus sushi, Lebanese, Thai and pizza — each
-- with a location, all-day hours, a full menu with Uber Eats-style options, and a published sample video
-- linked to its signature dish (so a right swipe in the feed opens that dish's order page). The videos
-- are clearly-labelled branded motion videos served by the dashboard (p_media_base/samples/*.mp4), to be
-- replaced with real footage in each restaurant's Videos page. Running it again changes nothing.

-- Internal: builds one restaurant from a description. Not callable by API users.
create or replace function public.seed_sample_restaurant(p_owner uuid, p_city uuid, p jsonb, p_media_base text)
returns uuid language plpgsql set search_path = public as $$
declare
  v_rest uuid; v_loc uuid; v_menu uuid; v_item uuid; v_group uuid; v_video uuid;
  it jsonb; g jsonb; o jsonb; v_parent uuid; i integer := 0; j integer; k integer;
begin
  select r.id into v_rest from public.restaurants r where r.slug like (p ->> 'slug') || '%' and r.created_by = p_owner order by r.created_at limit 1;
  if v_rest is null then
    insert into public.restaurants (name, slug, description, legal_name, cuisines, price_level, status, created_by)
    values (p ->> 'name',
            case when exists (select 1 from public.restaurants where slug = p ->> 'slug') then (p ->> 'slug') || '-' || substr(md5(p_owner::text), 1, 6) else p ->> 'slug' end,
            p ->> 'description', (p ->> 'name') || ' (sample)', array(select jsonb_array_elements_text(p -> 'cuisines')),
            (p ->> 'priceLevel')::smallint, 'verified', p_owner)
    returning id into v_rest;
    insert into public.restaurant_locations (restaurant_id, city_id, label, address_line1, suburb, region, postcode, lat, lng, pickup_enabled, prep_time_minutes, is_accepting_orders)
    values (v_rest, p_city, p ->> 'suburb', p ->> 'address', p ->> 'suburb', 'QLD', p ->> 'postcode', (p ->> 'lat')::float8, (p ->> 'lng')::float8, true, 15, true)
    returning id into v_loc;
    insert into public.location_opening_hours (location_id, day_of_week, opens_at, closes_at)
    select v_loc, d, '00:00', '23:59' from generate_series(0, 6) d;
    insert into public.menus (restaurant_id, name) values (v_rest, 'Main menu') returning id into v_menu;

    for it in select * from jsonb_array_elements(p -> 'items') loop
      i := i + 1;
      insert into public.menu_items (restaurant_id, menu_id, section, name, description, price_cents, cuisine, category, tags, dietary_tags, allergens, spice_level, sort_order)
      values (v_rest, v_menu, it ->> 'section', it ->> 'name', it ->> 'description', (it ->> 'price')::int, (p -> 'cuisines') ->> 0, it ->> 'category',
              array(select jsonb_array_elements_text(coalesce(it -> 'tags', '[]'))), array(select jsonb_array_elements_text(coalesce(it -> 'dietary', '[]'))),
              array(select jsonb_array_elements_text(coalesce(it -> 'allergens', '[]'))), (it ->> 'spice')::smallint, i)
      returning id into v_item;
      j := 0;
      for g in select * from jsonb_array_elements(coalesce(it -> 'groups', '[]')) loop
        j := j + 1;
        v_parent := null;
        if g ? 'parent' then
          select mo.id into v_parent from public.menu_item_options mo join public.menu_item_option_groups mg on mg.id = mo.group_id
           where mg.menu_item_id = v_item and mo.name = g ->> 'parent' limit 1;
        end if;
        insert into public.menu_item_option_groups (menu_item_id, name, min_select, max_select, sort_order, display_style, parent_option_id)
        values (v_item, g ->> 'name', (g ->> 'min')::smallint, (g ->> 'max')::smallint, j, coalesce(g ->> 'style', 'list'), v_parent)
        returning id into v_group;
        k := 0;
        for o in select * from jsonb_array_elements(g -> 'options') loop
          k := k + 1;
          insert into public.menu_item_options (group_id, name, price_delta_cents, max_quantity, sort_order)
          values (v_group, o ->> 'name', coalesce((o ->> 'price')::int, 0), coalesce((o ->> 'qty')::smallint, 1), k);
        end loop;
      end loop;
    end loop;
  end if;

  -- Sample video for the signature dish (once).
  if p_media_base is not null and p ? 'video' then
    select mi.id into v_item from public.menu_items mi where mi.restaurant_id = v_rest and mi.name = p #>> '{video,dish}' limit 1;
    if v_item is not null and not exists (
        select 1 from public.videos v where v.restaurant_id = v_rest and v.playback_url like '%/samples/%') then
      insert into public.videos (uploader_id, source, restaurant_id, caption, duration_ms, status, playback_url, thumbnail_url, published_at, rights_attested_at, hashtags)
      values (p_owner, 'restaurant', v_rest, p #>> '{video,caption}', 7000, 'published',
              p_media_base || '/samples/' || (p #>> '{video,file}') || '.mp4', p_media_base || '/samples/' || (p #>> '{video,file}') || '.jpg', now(), now(),
              array(select jsonb_array_elements_text(coalesce(p #> '{video,hashtags}', '[]'))))
      returning id into v_video;
      insert into public.video_menu_items (video_id, menu_item_id, restaurant_id, status, is_primary)
      values (v_video, v_item, v_rest, 'approved', true);
    end if;
  end if;
  return v_rest;
end $$;
revoke all on function public.seed_sample_restaurant(uuid, uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.admin_create_sample_restaurants(p_media_base text default null)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_city uuid;
  v_ids uuid[] := '{}';
  v_demo uuid;
  r jsonb;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if p_media_base is not null and p_media_base !~ '^https?://[^/\s]+$' then
    raise exception 'Media address must be like https://example.com' using errcode = '22023';
  end if;
  select c.id into v_city from public.cities c where c.name = 'Brisbane' and c.region = 'QLD' limit 1;
  if v_city is null then raise exception 'Brisbane is not set up in cities' using errcode = 'P0002'; end if;

  -- 1. CRAVE Demo Kitchen (burgers) + its sample video.
  v_demo := public.admin_create_demo_restaurant();
  v_ids := v_ids || public.seed_sample_restaurant(v_owner, v_city, jsonb_build_object('slug', (select slug from public.restaurants where id = v_demo),
    'video', jsonb_build_object('file', 'burger', 'dish', 'Double Smash Burger', 'caption', 'Two patties, cheese pull, house sauce. Swipe right to order', 'hashtags', jsonb_build_array('burger', 'smashburger'))), p_media_base);

  for r in select * from jsonb_array_elements($json$[
    {"name": "Kōen Sushi Bar", "slug": "koen-sushi-bar", "cuisines": ["japanese"], "priceLevel": 2,
     "description": "Aburi nigiri, hand rolls and donburi in the CBD. A sample restaurant on CRAVE.",
     "suburb": "Brisbane City", "postcode": "4000", "lat": -27.4705, "lng": 153.0260, "address": "2 Sample Arcade",
     "video": {"file": "sushi", "dish": "Salmon Aburi Nigiri", "caption": "Flame-seared salmon, melt in your mouth", "hashtags": ["sushi", "aburi"]},
     "items": [
       {"section": "Nigiri", "name": "Salmon Aburi Nigiri", "description": "Six pieces of flame-seared salmon with house mayo and spring onion.", "price": 1450, "category": "sushi", "tags": ["salmon", "seared"], "allergens": ["fish", "egg", "soy", "sesame"],
        "groups": [{"name": "Pieces", "min": 1, "max": 1, "style": "chips", "options": [{"name": "6 pieces"}, {"name": "10 pieces", "price": 850}]},
                   {"name": "Remove", "min": 0, "max": 2, "style": "remove", "options": [{"name": "Mayo"}, {"name": "Spring onion"}]}]},
       {"section": "Rolls", "name": "Spicy Tuna Roll", "description": "Tuna, chilli mayo, cucumber, tobiko.", "price": 1290, "category": "sushi", "tags": ["tuna", "spicy"], "allergens": ["fish", "egg", "soy", "sesame"], "spice": 2},
       {"section": "Rolls", "name": "Avocado Cucumber Roll", "description": "Fresh and simple.", "price": 990, "category": "sushi", "tags": ["avocado"], "dietary": ["vegetarian", "vegan"], "allergens": ["soy", "sesame"]},
       {"section": "Donburi", "name": "Chicken Katsu Don", "description": "Crumbed chicken, egg and onion over rice.", "price": 1790, "category": "donburi", "tags": ["chicken", "fried", "rice"], "allergens": ["gluten", "wheat", "egg", "soy"],
        "groups": [{"name": "Rice", "min": 1, "max": 1, "style": "chips", "options": [{"name": "Regular"}, {"name": "Large", "price": 200}]},
                   {"name": "Extras", "min": 0, "max": 3, "options": [{"name": "Extra katsu", "price": 500, "qty": 2}, {"name": "Onsen egg", "price": 250}, {"name": "Kimchi", "price": 300}]}]},
       {"section": "Sides", "name": "Edamame", "description": "Sea salt.", "price": 690, "category": "side", "tags": ["soy"], "dietary": ["vegetarian", "vegan"], "allergens": ["soy"]},
       {"section": "Drinks", "name": "Iced Matcha Latte", "description": "Ceremonial matcha.", "price": 690, "category": "drink", "tags": ["matcha"], "allergens": ["milk"],
        "groups": [{"name": "Milk", "min": 1, "max": 1, "style": "chips", "options": [{"name": "Full cream"}, {"name": "Oat", "price": 80}]}]}
     ]},
    {"name": "Cedar & Ember Grill", "slug": "cedar-ember-grill", "cuisines": ["lebanese"], "priceLevel": 2,
     "description": "Charcoal grills, shawarma and fresh-baked bread in West End. A sample restaurant on CRAVE.",
     "suburb": "West End", "postcode": "4101", "lat": -27.4820, "lng": 153.0090, "address": "3 Sample Street",
     "video": {"file": "lebanese", "dish": "Mixed Grill Plate", "caption": "Off the charcoal, straight to you", "hashtags": ["lebanese", "mixedgrill"]},
     "items": [
       {"section": "Plates", "name": "Mixed Grill Plate", "description": "Lamb kofta, chicken shish and lamb skewers with rice, salad, hummus and bread.", "price": 2600, "category": "grill", "tags": ["lamb", "chicken", "charcoal"], "allergens": ["gluten", "wheat", "sesame"],
        "groups": [{"name": "Sauce", "min": 1, "max": 2, "style": "chips", "options": [{"name": "Garlic toum"}, {"name": "Chilli"}, {"name": "Tahini"}]},
                   {"name": "Add", "min": 0, "max": 2, "options": [{"name": "Extra skewer", "price": 600, "qty": 2}, {"name": "Chips", "price": 400}]}]},
       {"section": "Wraps", "name": "Chicken Shawarma Wrap", "description": "Marinated chicken, garlic toum, pickles and chips in bread.", "price": 1490, "category": "wrap", "tags": ["chicken", "shawarma"], "allergens": ["gluten", "wheat", "egg"],
        "groups": [{"name": "Heat", "min": 1, "max": 1, "style": "chips", "options": [{"name": "No chilli"}, {"name": "Chilli"}]},
                   {"name": "Remove", "min": 0, "max": 2, "style": "remove", "options": [{"name": "Pickles"}, {"name": "Garlic"}]}]},
       {"section": "Plates", "name": "Falafel Plate", "description": "Crispy falafel, hummus, tabouli and bread.", "price": 1890, "category": "falafel", "tags": ["falafel"], "dietary": ["vegetarian", "vegan"], "allergens": ["gluten", "wheat", "sesame"]},
       {"section": "Dips", "name": "Hummus & Bread", "description": "Smooth hummus, olive oil, warm bread.", "price": 990, "category": "dip", "tags": ["hummus"], "dietary": ["vegetarian", "vegan"], "allergens": ["gluten", "wheat", "sesame"]},
       {"section": "Sweets", "name": "Baklava (3)", "description": "Pistachio and honey.", "price": 790, "category": "dessert", "tags": ["sweet", "pistachio"], "allergens": ["gluten", "wheat", "tree_nuts", "milk"]}
     ]},
    {"name": "Little Lantern Thai", "slug": "little-lantern-thai", "cuisines": ["thai"], "priceLevel": 2,
     "description": "Wok-fired classics and fragrant curries in South Brisbane. A sample restaurant on CRAVE.",
     "suburb": "South Brisbane", "postcode": "4101", "lat": -27.4778, "lng": 153.0174, "address": "4 Sample Lane",
     "video": {"file": "thai", "dish": "Green Curry", "caption": "Fragrant, creamy, a little bit fiery", "hashtags": ["thai", "greencurry"]},
     "items": [
       {"section": "Curries", "name": "Green Curry", "description": "Coconut green curry with Thai basil and vegetables, with jasmine rice.", "price": 1990, "category": "curry", "tags": ["coconut", "curry"], "allergens": ["fish"], "spice": 2,
        "groups": [{"name": "Protein", "min": 1, "max": 1, "options": [{"name": "Chicken"}, {"name": "Beef", "price": 200}, {"name": "Prawn", "price": 400}, {"name": "Tofu"}]},
                   {"name": "Spice", "min": 1, "max": 1, "style": "chips", "options": [{"name": "Mild"}, {"name": "Medium"}, {"name": "Thai hot"}]}]},
       {"section": "Wok", "name": "Pad Thai", "description": "Rice noodles, tamarind, egg, peanuts and bean sprouts.", "price": 1890, "category": "noodles", "tags": ["noodles", "peanut"], "allergens": ["egg", "peanut", "fish", "soy"],
        "groups": [{"name": "Protein", "min": 1, "max": 1, "options": [{"name": "Chicken"}, {"name": "Prawn", "price": 400}, {"name": "Tofu"}]},
                   {"name": "Remove", "min": 0, "max": 2, "style": "remove", "options": [{"name": "Peanuts"}, {"name": "Egg"}]}]},
       {"section": "Wok", "name": "Crispy Pork Belly", "description": "With chilli jam and Asian greens.", "price": 2190, "category": "pork", "tags": ["pork", "crispy"], "allergens": ["soy", "fish"], "spice": 1},
       {"section": "Starters", "name": "Fresh Rice Paper Rolls (3)", "description": "Herbs, vermicelli and tofu with peanut dipping sauce.", "price": 1090, "category": "rolls", "tags": ["fresh"], "dietary": ["vegetarian", "vegan"], "allergens": ["peanut", "soy"]},
       {"section": "Desserts", "name": "Mango Sticky Rice", "description": "Sweet coconut sticky rice with fresh mango.", "price": 990, "category": "dessert", "tags": ["mango", "sweet"], "dietary": ["vegetarian", "vegan"]}
     ]},
    {"name": "Forno Rosso Pizzeria", "slug": "forno-rosso-pizzeria", "cuisines": ["italian"], "priceLevel": 2,
     "description": "Wood-fired Neapolitan pizza and tiramisu in New Farm. A sample restaurant on CRAVE.",
     "suburb": "New Farm", "postcode": "4005", "lat": -27.4670, "lng": 153.0450, "address": "5 Sample Road",
     "video": {"file": "pizza", "dish": "Margherita", "caption": "Blistered crust, San Marzano, fior di latte", "hashtags": ["pizza", "woodfired"]},
     "items": [
       {"section": "Pizza", "name": "Margherita", "description": "San Marzano tomato, fior di latte and basil.", "price": 2100, "category": "pizza", "tags": ["cheese", "woodfired"], "dietary": ["vegetarian"], "allergens": ["gluten", "wheat", "milk"],
        "groups": [{"name": "Base", "min": 1, "max": 1, "style": "chips", "options": [{"name": "Classic"}, {"name": "Gluten-free base", "price": 400}]},
                   {"name": "Extra toppings", "min": 0, "max": 4, "options": [{"name": "Buffalo mozzarella", "price": 450}, {"name": "Prosciutto", "price": 500}, {"name": "Chilli oil", "price": 150}, {"name": "Olives", "price": 200}]}]},
       {"section": "Pizza", "name": "Pepperoni", "description": "Tomato, mozzarella and spicy pepperoni.", "price": 2400, "category": "pizza", "tags": ["pepperoni", "spicy", "woodfired"], "allergens": ["gluten", "wheat", "milk"], "spice": 1,
        "groups": [{"name": "Base", "min": 1, "max": 1, "style": "chips", "options": [{"name": "Classic"}, {"name": "Gluten-free base", "price": 400}]}]},
       {"section": "Pizza", "name": "Truffle Mushroom", "description": "Mushrooms, mozzarella, truffle oil and thyme. White base.", "price": 2500, "category": "pizza", "tags": ["mushroom", "truffle"], "dietary": ["vegetarian"], "allergens": ["gluten", "wheat", "milk"]},
       {"section": "Sides", "name": "Garlic Bread", "description": "Wood-fired, garlic butter, parsley.", "price": 890, "category": "bread", "tags": ["garlic"], "dietary": ["vegetarian"], "allergens": ["gluten", "wheat", "milk"]},
       {"section": "Desserts", "name": "Tiramisu", "description": "Mascarpone, espresso, cocoa.", "price": 1100, "category": "dessert", "tags": ["coffee", "sweet"], "allergens": ["gluten", "wheat", "milk", "egg"]}
     ]}
  ]$json$::jsonb) loop
    v_ids := v_ids || public.seed_sample_restaurant(v_owner, v_city, r, p_media_base);
  end loop;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (v_owner, 'sample_restaurants_created', 'restaurant', null, jsonb_build_object('count', array_length(v_ids, 1)));
  return v_ids;
end $$;
revoke all on function public.admin_create_sample_restaurants(text) from public, anon;
grant execute on function public.admin_create_sample_restaurants(text) to authenticated;
