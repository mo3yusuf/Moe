import 'server-only';
import { notFound } from 'next/navigation';
import { supabaseServer } from './supabase/server';

/** Loads a restaurant the viewer is a member of (RLS-enforced) or 404s. */
export async function loadMemberRestaurant(id: string) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: member } = await supabase.from('restaurant_members').select('role').eq('restaurant_id', id).eq('user_id', user.id).maybeSingle();
  const { data: restaurant } = await supabase.from('restaurants').select('*').eq('id', id).maybeSingle();
  if (!restaurant || !member) notFound();
  return { supabase, user, restaurant, role: member.role as 'owner' | 'manager' | 'staff' };
}

export const canManage = (role: string) => role === 'owner' || role === 'manager';
