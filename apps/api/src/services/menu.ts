import { NOT_ORDERABLE_MESSAGES, isOpenAt, orderability, type DayOfWeek, type OpeningPeriod } from '@crave/core';
import type { Sql } from '../db';
import { notFound } from '../errors';

interface RestaurantRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cuisines: string[];
  logo_url: string | null;
  cover_url: string | null;
  rating_avg: string | null;
  rating_count: number;
  accepting_orders: boolean;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  accepts_advance_orders: boolean;
  avg_prep_minutes: number;
  verified_dietary: string[];
  is_demo: boolean;
  location_id: string;
  street_line: string;
  suburb: string;
  state: string;
  postcode: string;
  unit: string | null;
  lat: number;
  lng: number;
  timezone: string;
  pickup_instructions: string | null;
}

async function activeRestaurant(sql: Sql, restaurantId: string): Promise<RestaurantRow> {
  const [r] = await sql<RestaurantRow[]>`
    select r.id, r.name, r.slug, r.description, r.cuisines, r.logo_url, r.cover_url, r.rating_avg::text, r.rating_count,
           r.accepting_orders, r.pickup_enabled, r.delivery_enabled, r.accepts_advance_orders, r.avg_prep_minutes,
           r.verified_dietary, r.is_demo,
           l.id as location_id, l.street_line, l.suburb, l.state, l.postcode, l.unit, l.lat, l.lng, l.timezone, l.pickup_instructions
    from public.restaurants r
    join public.restaurant_locations l on l.restaurant_id = r.id and l.is_primary
    where r.id = ${restaurantId} and r.status = 'active'`;
  if (!r) throw notFound('Restaurant not found');
  return r;
}

async function hoursFor(sql: Sql, locationId: string) {
  const rows = await sql<{ day_of_week: number; opens: string; closes: string }[]>`
    select day_of_week, to_char(opens_at, 'HH24:MI') as opens, to_char(closes_at, 'HH24:MI') as closes
    from public.opening_hours where location_id = ${locationId} order by day_of_week, opens_at`;
  const closures = await sql<{ closed_on: string }[]>`
    select to_char(closed_on, 'YYYY-MM-DD') as closed_on from public.special_closures where location_id = ${locationId} and closed_on >= current_date - 1`;
  const periods: OpeningPeriod[] = rows.map((h) => ({ dayOfWeek: h.day_of_week as DayOfWeek, opensAt: h.opens, closesAt: h.closes }));
  return { periods, closures: closures.map((c) => ({ date: c.closed_on })) };
}

function restaurantDto(r: RestaurantRow, openNow: boolean, periods: OpeningPeriod[]) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    cuisines: r.cuisines,
    logoUrl: r.logo_url,
    coverUrl: r.cover_url,
    ratingAvg: r.rating_avg !== null ? Number(r.rating_avg) : null,
    ratingCount: r.rating_count,
    isDemo: r.is_demo,
    verifiedDietary: r.verified_dietary,
    acceptingOrders: r.accepting_orders,
    pickupEnabled: r.pickup_enabled,
    deliveryEnabled: false, // delivery module not integrated yet
    acceptsAdvanceOrders: r.accepts_advance_orders,
    avgPrepMinutes: r.avg_prep_minutes,
    openNow,
    hours: periods,
    location: {
      id: r.location_id,
      address: `${r.unit ? `${r.unit}/` : ''}${r.street_line}, ${r.suburb} ${r.state} ${r.postcode}`,
      suburb: r.suburb,
      lat: r.lat,
      lng: r.lng,
      pickupInstructions: r.pickup_instructions,
    },
  };
}

export async function getRestaurantMenu(sql: Sql, restaurantId: string, now = new Date()) {
  const r = await activeRestaurant(sql, restaurantId);
  const { periods, closures } = await hoursFor(sql, r.location_id);
  const openNow = isOpenAt(periods, now, r.timezone, closures);
  const categories = await sql<{ id: string; name: string }[]>`
    select c.id, c.name from public.menu_categories c join public.menus m on m.id = c.menu_id
    where c.restaurant_id = ${restaurantId} and m.is_active order by m.sort_order, c.sort_order`;
  const items = await sql<{ id: string; category_id: string | null; name: string; description: string | null; price_cents: number; is_available: boolean; image_url: string | null; dietary_attributes: string[]; spice_level: number | null }[]>`
    select id, category_id, name, description, price_cents, is_available, image_url, dietary_attributes, spice_level
    from public.menu_items where restaurant_id = ${restaurantId} and archived_at is null order by sort_order, name`;
  const videos = await sql<{ id: string; menu_item_id: string }[]>`
    select l.video_id as id, l.menu_item_id from public.video_menu_items l join public.videos v on v.id = l.video_id
    where l.restaurant_id = ${restaurantId} and l.status = 'approved' and v.status = 'published'`;
  const videoByItem = new Map<string, string[]>();
  for (const v of videos) videoByItem.set(v.menu_item_id, [...(videoByItem.get(v.menu_item_id) ?? []), v.id]);

  return {
    restaurant: restaurantDto(r, openNow, periods),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: items
        .filter((i) => i.category_id === c.id)
        .map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          priceCents: i.price_cents,
          available: i.is_available,
          imageUrl: i.image_url,
          dietary: i.dietary_attributes,
          spiceLevel: i.spice_level,
          videoIds: videoByItem.get(i.id) ?? [],
        })),
    })),
  };
}

export async function getMenuItem(sql: Sql, menuItemId: string, now = new Date()) {
  const [item] = await sql<{ id: string; restaurant_id: string; name: string; description: string | null; price_cents: number; currency: string; is_available: boolean; image_url: string | null; dietary_attributes: string[]; allergens: string[]; spice_level: number | null }[]>`
    select id, restaurant_id, name, description, price_cents, currency, is_available, image_url, dietary_attributes, allergens, spice_level
    from public.menu_items where id = ${menuItemId} and archived_at is null`;
  if (!item) throw notFound('Menu item not found');
  const r = await activeRestaurant(sql, item.restaurant_id);
  const { periods, closures } = await hoursFor(sql, r.location_id);
  const openNow = isOpenAt(periods, now, r.timezone, closures);
  const groups = await sql<{ id: string; name: string; min_select: number; max_select: number }[]>`
    select id, name, min_select, max_select from public.modifier_groups where menu_item_id = ${menuItemId} order by sort_order`;
  const options = groups.length
    ? await sql<{ id: string; group_id: string; name: string; price_delta_cents: number; is_available: boolean; is_default: boolean }[]>`
        select id, group_id, name, price_delta_cents, is_available, is_default from public.modifier_options
        where group_id in ${sql(groups.map((g) => g.id))} order by sort_order`
    : [];
  const status = orderability({
    restaurantStatus: 'active',
    acceptingOrders: r.accepting_orders,
    pickupEnabled: r.pickup_enabled,
    isOpenNow: openNow,
    acceptsAdvanceOrders: r.accepts_advance_orders,
    itemAvailable: item.is_available,
  });
  return {
    item: {
      id: item.id,
      name: item.name,
      description: item.description,
      priceCents: item.price_cents,
      currency: item.currency,
      imageUrl: item.image_url,
      dietary: item.dietary_attributes,
      allergens: item.allergens,
      spiceLevel: item.spice_level,
      modifierGroups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        options: options
          .filter((o) => o.group_id === g.id)
          .map((o) => ({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents, available: o.is_available, isDefault: o.is_default })),
      })),
    },
    restaurant: restaurantDto(r, openNow, periods),
    orderable: status.orderable,
    notOrderableReason: status.orderable ? null : NOT_ORDERABLE_MESSAGES[status.reason],
  };
}
