'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

export async function submitVerification(restaurantId: string, licence: string, paths: string[]) {
  const clean = paths.filter((p) => p.startsWith(`${restaurantId}/`) && !p.includes('..')).slice(0, 10);
  if (!licence.trim()) return { error: 'Enter your food business licence number (Brisbane City Council or your local council).' };
  if (!clean.length) return { error: 'Upload at least one document.' };
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Please sign in again.' };
  const ins = await supabase.from('restaurant_verifications').insert({
    restaurant_id: restaurantId, submitted_by: user.id, document_paths: clean, food_business_licence_number: licence.trim().slice(0, 60),
  });
  if (ins.error) return { error: ins.error.message };
  const upd = await supabase.from('restaurants').update({ status: 'pending_verification' }).eq('id', restaurantId).in('status', ['draft', 'rejected']);
  if (upd.error) return { error: upd.error.message };
  revalidatePath(`/restaurant/${restaurantId}`, 'layout');
  return { ok: true };
}
