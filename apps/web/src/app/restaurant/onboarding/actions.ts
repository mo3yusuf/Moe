'use server';
import { BRISBANE_SUBURBS, CUISINES, isValidAbn, isValidAuPhone, normaliseAbn, slugify } from '@crave/core';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export interface OnboardState { error?: string; fields?: Record<string, string> }

export async function createRestaurant(_prev: OnboardState | undefined, form: FormData): Promise<OnboardState> {
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const fields = Object.fromEntries(['name', 'legalName', 'abn', 'description', 'suburb', 'address', 'phone', 'priceLevel', 'prepTime'].map((k) => [k, get(k)]));
  const fail = (error: string) => ({ error, fields });

  const name = fields.name!;
  if (name.length < 2 || name.length > 100) return fail('Enter your restaurant name (2–100 characters).');
  if (!isValidAbn(fields.abn!)) return fail('That ABN is not valid. Check the 11 digits on the ABN Lookup register.');
  if (!fields.legalName) return fail('Enter the legal entity name registered to the ABN.');
  const suburb = BRISBANE_SUBURBS[fields.suburb!];
  if (!suburb) return fail('Choose your suburb.');
  if (fields.address!.length < 4) return fail('Enter the street address.');
  if (fields.phone && !isValidAuPhone(fields.phone)) return fail('Enter a valid Australian phone number.');
  const cuisines = form.getAll('cuisines').map(String).filter((c) => (CUISINES as readonly string[]).includes(c));
  if (!cuisines.length) return fail('Choose at least one cuisine.');
  const priceLevel = Math.min(4, Math.max(1, Number(fields.priceLevel) || 2));
  const prepTime = Math.min(120, Math.max(5, Number(fields.prepTime) || 15));

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/restaurant/onboarding');
  const { data: city } = await supabase.from('cities').select('id').eq('name', 'Brisbane').eq('region', 'QLD').single();
  if (!city) return fail('Brisbane is not configured yet. Contact CRAVE support.');

  // Status and commission are forced server-side by database triggers (draft / platform default).
  let restaurantId: string | null = null;
  for (let attempt = 0; attempt < 3 && !restaurantId; attempt++) {
    const slug = attempt === 0 ? slugify(name) : `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase.from('restaurants').insert({
      name, slug, legal_name: fields.legalName, abn: normaliseAbn(fields.abn!), description: fields.description || null,
      cuisines, price_level: priceLevel, created_by: user.id,
    }).select('id').single();
    if (data) restaurantId = data.id;
    else if (error && error.code !== '23505') return fail(`Could not create restaurant: ${error.message}`);
  }
  if (!restaurantId) return fail('Could not create a unique restaurant link. Try a slightly different name.');

  const { data: loc, error: locErr } = await supabase.from('restaurant_locations').insert({
    restaurant_id: restaurantId, city_id: city.id, label: fields.suburb, address_line1: fields.address,
    suburb: fields.suburb, region: 'QLD', postcode: suburb.postcode, lat: suburb.lat, lng: suburb.lng,
    phone: fields.phone || null, prep_time_minutes: prepTime, pickup_enabled: true,
  }).select('id').single();
  if (locErr || !loc) return fail(`Restaurant created, but the location failed: ${locErr?.message}. Open your dashboard to retry.`);

  // Sensible default hours (editable): 11:00–21:00 every day.
  await supabase.from('location_opening_hours').insert(
    Array.from({ length: 7 }, (_, d) => ({ location_id: loc.id, day_of_week: d, opens_at: '11:00', closes_at: '21:00' })));
  await supabase.from('menus').insert({ restaurant_id: restaurantId, name: 'Main menu' });

  redirect(`/restaurant/${restaurantId}`);
}
