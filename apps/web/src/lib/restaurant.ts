import 'server-only';
import { notFound } from 'next/navigation';
import { supabaseServer } from './supabase/server';

/** Columns of `restaurants` any visitor may read (the rest are private; see restaurants_private). */
export const PUBLIC_RESTAURANT_COLUMNS = 'id, name, slug, description, logo_url, cover_url, cuisines, price_level, status, accepts_advance_orders, created_by, created_at, updated_at';

/** Loads a restaurant the viewer is a member of (RLS-enforced) or 404s. */
export async function loadMemberRestaurant(id: string) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: member } = await supabase.from('restaurant_members').select('role').eq('restaurant_id', id).eq('user_id', user.id).maybeSingle();
  const [{ data: pub }, { data: priv }] = await Promise.all([
    supabase.from('restaurants').select(PUBLIC_RESTAURANT_COLUMNS).eq('id', id).maybeSingle(),
    // Private business fields (ABN, commission, Stripe) come through a members-only function.
    supabase.rpc('restaurants_private', { p_ids: [id] }),
  ]);
  if (!pub || !member) notFound();
  const restaurant = { ...(pub as Record<string, unknown>), ...((priv as Record<string, unknown>[] | null)?.[0] ?? {}) } as any;
  return { supabase, user, restaurant, role: member.role as 'owner' | 'manager' | 'staff' };
}

export const canManage = (role: string) => role === 'owner' || role === 'manager';
