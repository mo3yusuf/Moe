'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveHours(restaurantId: string, locationId: string, _p: { error?: string; ok?: string } | undefined, form: FormData) {
  const rows: { location_id: string; day_of_week: number; opens_at: string; closes_at: string }[] = [];
  for (let d = 0; d < 7; d++) {
    if (form.get(`closed-${d}`) === 'on') continue;
    const opens = String(form.get(`opens-${d}`) ?? ''), closes = String(form.get(`closes-${d}`) ?? '');
    if (!TIME.test(opens) || !TIME.test(closes)) return { error: 'Enter times as HH:MM for every open day.' };
    if (opens === closes) return { error: 'Opening and closing times cannot be the same.' };
    rows.push({ location_id: locationId, day_of_week: d, opens_at: opens, closes_at: closes });
  }
  const supabase = await supabaseServer();
  const { data: loc } = await supabase.from('restaurant_locations').select('id').eq('id', locationId).eq('restaurant_id', restaurantId).maybeSingle();
  if (!loc) return { error: 'Location not found' };
  // Replace the weekly schedule (RLS: owner/manager only).
  const del = await supabase.from('location_opening_hours').delete().eq('location_id', locationId);
  if (del.error) return { error: del.error.message };
  if (rows.length) {
    const ins = await supabase.from('location_opening_hours').insert(rows);
    if (ins.error) return { error: ins.error.message };
  }
  revalidatePath(`/restaurant/${restaurantId}/hours`);
  return { ok: 'Opening hours saved' };
}

export async function setAccepting(restaurantId: string, locationId: string, accepting: boolean) {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('set_location_accepting_orders', { p_location_id: locationId, p_accepting: accepting });
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurant/${restaurantId}/hours`);
}

export async function saveSettings(restaurantId: string, locationId: string, form: FormData) {
  const supabase = await supabaseServer();
  const prep = Math.min(120, Math.max(5, Number(form.get('prep')) || 15));
  const radius = Number(form.get('radius'));
  const minOrder = Math.round(Number(form.get('minOrder') || 20) * 100);
  await supabase.from('restaurant_locations').update({
    prep_time_minutes: prep, pickup_enabled: form.get('pickup') === 'on',
    delivery_enabled: form.get('delivery') === 'on',
    delivery_radius_km: radius > 0 && radius <= 15 ? radius : null,
    delivery_min_order_cents: Number.isFinite(minOrder) && minOrder >= 0 ? minOrder : 2000,
  }).eq('id', locationId);
  await supabase.from('restaurants').update({ accepts_advance_orders: form.get('advance') === 'on' }).eq('id', restaurantId);
  revalidatePath(`/restaurant/${restaurantId}/hours`);
}
