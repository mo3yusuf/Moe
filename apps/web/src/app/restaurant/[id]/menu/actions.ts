'use server';
import { ALLERGENS, CUISINES, DIETARY_TAGS } from '@crave/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { publicEnv } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

export interface FormState { error?: string; ok?: string }

/** Parses "$16.90" / "16.9" / "16" into integer cents. */
function parsePrice(input: string): number | null {
  const m = input.replace(/[$,\s]/g, '').match(/^(\d{1,5})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

function readItem(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const price = parsePrice(get('price'));
  const cuisine = get('cuisine');
  const spice = get('spice');
  return {
    error: !get('name') ? 'Item name is required.' : price == null ? 'Enter a valid price, e.g. 16.90 (GST inclusive).' : null,
    row: {
      name: get('name').slice(0, 120),
      description: get('description').slice(0, 600) || null,
      section: get('section').slice(0, 60) || 'Mains',
      price_cents: price ?? 0,
      cuisine: (CUISINES as readonly string[]).includes(cuisine) ? cuisine : null,
      category: get('category').toLowerCase().replace(/[^a-z_ ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || null,
      tags: get('tags').toLowerCase().split(',').map((t) => t.trim().replace(/\s+/g, '_')).filter((t) => /^[a-z_]{2,30}$/.test(t)).slice(0, 12),
      dietary_tags: form.getAll('dietary').map(String).filter((d) => (DIETARY_TAGS as readonly string[]).includes(d)),
      allergens: form.getAll('allergens').map(String).filter((a) => (ALLERGENS as readonly string[]).includes(a)),
      spice_level: spice === '' ? null : Math.min(4, Math.max(0, Number(spice))),
      gst_applicable: form.get('gstFree') !== 'on',
      is_combo: form.get('isCombo') === 'on',
    },
  };
}

export async function addItem(restaurantId: string, _p: FormState | undefined, form: FormData): Promise<FormState> {
  const { error, row } = readItem(form);
  if (error) return { error };
  const supabase = await supabaseServer();
  const { data: menu } = await supabase.from('menus').select('id').eq('restaurant_id', restaurantId).order('sort_order').limit(1).maybeSingle();
  const { data, error: dbErr } = await supabase.from('menu_items').insert({ ...row, restaurant_id: restaurantId, menu_id: menu?.id ?? null }).select('id').single();
  if (dbErr || !data) return { error: dbErr?.message ?? 'Could not add item' };
  redirect(`/restaurant/${restaurantId}/menu/${data.id}`);
}

export async function updateItem(restaurantId: string, itemId: string, _p: FormState | undefined, form: FormData): Promise<FormState> {
  const { error, row } = readItem(form);
  if (error) return { error };
  const supabase = await supabaseServer();
  const { error: dbErr } = await supabase.from('menu_items').update(row).eq('id', itemId).eq('restaurant_id', restaurantId);
  if (dbErr) return { error: dbErr.message };
  revalidatePath(`/restaurant/${restaurantId}/menu`);
  return { ok: 'Saved' };
}

export async function toggleAvailability(restaurantId: string, itemId: string, available: boolean) {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('set_menu_item_availability', { p_menu_item_id: itemId, p_available: available });
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurant/${restaurantId}/menu`);
}

export async function deleteItem(restaurantId: string, itemId: string) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('menu_items').delete().eq('id', itemId).eq('restaurant_id', restaurantId);
  if (error) throw new Error(error.message);
  redirect(`/restaurant/${restaurantId}/menu`);
}

/** Saves an image already uploaded by the browser to menu-images/<restaurantId>/... (storage policy enforced). */
export async function setItemImage(restaurantId: string, itemId: string, path: string) {
  if (!path.startsWith(`${restaurantId}/`) || path.includes('..')) throw new Error('Invalid image path');
  const url = `${publicEnv.supabaseUrl}/storage/v1/object/public/menu-images/${path}`;
  const supabase = await supabaseServer();
  const { error } = await supabase.from('menu_items').update({ image_url: url }).eq('id', itemId).eq('restaurant_id', restaurantId);
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurant/${restaurantId}/menu/${itemId}`);
}

/**
 * One option per line: "Name | price | up to N | https://photo". Every part after the name is optional
 * and can be in any order, e.g. "Extra patty | 4.00 | up to 3" or "Coke | https://…/coke.jpg".
 */
function parseOptionLine(line: string, i: number) {
  const [label, ...parts] = line.split('|').map((x) => x.trim());
  let price: number | null = 0, maxQuantity = 1, imageUrl: string | null = null, bad = false;
  for (const part of parts) {
    if (!part) continue;
    const qty = part.match(/^(?:x|up to|max)\s*(\d{1,2})$/i);
    if (qty) maxQuantity = Math.min(20, Math.max(1, Number(qty[1])));
    else if (/^https:\/\//.test(part)) imageUrl = part.slice(0, 500);
    else { price = parsePrice(part.replace(/^\+/, '')); if (price == null) bad = true; }
  }
  return { row: { name: label!.slice(0, 80), price_delta_cents: price ?? 0, max_quantity: maxQuantity, image_url: imageUrl, sort_order: i }, bad };
}

export async function addOptionGroup(restaurantId: string, itemId: string, _p: FormState | undefined, form: FormData): Promise<FormState> {
  const name = String(form.get('name') ?? '').trim();
  const min = Number(form.get('min') ?? 0), max = Number(form.get('max') ?? 1);
  const style = String(form.get('style') ?? 'list');
  const parentOptionId = String(form.get('parent') ?? '') || null;
  const linkDishes = form.get('linkDishes') === 'on';
  if (!name) return { error: 'Group name is required' };
  if (!['list', 'chips', 'remove'].includes(style)) return { error: 'Pick how the choices are shown.' };
  if (!(min >= 0 && max >= 1 && max >= min && max <= 20)) return { error: 'Choose a valid min/max (e.g. required single choice: 1/1).' };
  const parsed = String(form.get('options') ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map(parseOptionLine);
  if (!parsed.length) return { error: 'Add at least one option, one per line, e.g. "Extra cheese | 2.00"' };
  if (parsed.some((o) => o.bad)) return { error: 'Prices must look like 2.00, quantities like "up to 3", photos must start with https://' };
  const options: Record<string, unknown>[] = parsed.map((o) => o.row);
  if (min > options.length) return { error: 'Minimum selections cannot exceed the number of options.' };
  const supabase = await supabaseServer();
  if (linkDishes) {
    // Meal deals: link each choice to the dish with the same name, so it shows sold out when that dish is.
    const { data: dishes } = await supabase.from('menu_items').select('id, name').eq('restaurant_id', restaurantId);
    const byName = new Map((dishes ?? []).map((d) => [d.name.trim().toLowerCase(), d.id]));
    const missing = options.filter((o) => !byName.has(String(o.name).toLowerCase())).map((o) => o.name);
    if (missing.length) return { error: `These meal-deal choices don’t match a dish on your menu: ${missing.join(', ')}. Use the exact dish names.` };
    for (const o of options) o.linked_menu_item_id = byName.get(String(o.name).toLowerCase());
  }
  const { data: group, error } = await supabase.from('menu_item_option_groups')
    .insert({ menu_item_id: itemId, name, min_select: min, max_select: max, display_style: style, parent_option_id: parentOptionId })
    .select('id').single();
  if (error || !group) return { error: error?.message ?? 'Could not add group' };
  const { error: optErr } = await supabase.from('menu_item_options').insert(options.map((o) => ({ ...o, group_id: group.id })));
  if (optErr) { await supabase.from('menu_item_option_groups').delete().eq('id', group.id); return { error: optErr.message }; }
  revalidatePath(`/restaurant/${restaurantId}/menu/${itemId}`);
  return { ok: 'Customisation added' };
}

export async function deleteOptionGroup(restaurantId: string, itemId: string, groupId: string) {
  const supabase = await supabaseServer();
  await supabase.from('menu_item_option_groups').delete().eq('id', groupId).eq('menu_item_id', itemId);
  revalidatePath(`/restaurant/${restaurantId}/menu/${itemId}`);
}
