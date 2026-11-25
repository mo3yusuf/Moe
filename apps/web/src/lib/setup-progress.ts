import type { SupabaseClient } from '@supabase/supabase-js';

export type SetupStep = 'details' | 'hours' | 'menu' | 'payouts' | 'verify';
export const SETUP_STEPS: { key: SetupStep; label: string }[] = [
  { key: 'details', label: 'Store details' },
  { key: 'hours', label: 'Opening hours' },
  { key: 'menu', label: 'Menu' },
  { key: 'payouts', label: 'Get paid' },
  { key: 'verify', label: 'Documents' },
];

/** Which store-setup steps are done, worked out from what's saved (so owners can leave and come back). */
export async function setupProgress(supabase: SupabaseClient, restaurant: { id: string; status: string; payouts_enabled?: boolean | null }) {
  const [{ data: loc }, { count: items }, { data: verifications }] = await Promise.all([
    supabase.from('restaurant_locations').select('id, location_opening_hours(id)').eq('restaurant_id', restaurant.id).order('created_at').limit(1).maybeSingle(),
    supabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurant.id),
    supabase.from('restaurant_verifications').select('status, submitted_at').eq('restaurant_id', restaurant.id).order('submitted_at', { ascending: false }).limit(1),
  ]);
  const latestVerification = verifications?.[0] ?? null;
  const done: Record<SetupStep, boolean> = {
    details: true,
    hours: ((loc as { location_opening_hours?: unknown[] } | null)?.location_opening_hours?.length ?? 0) > 0,
    menu: (items ?? 0) > 0,
    payouts: !!restaurant.payouts_enabled,
    verify: restaurant.status === 'verified' || (!!latestVerification && !['rejected', 'more_info_required'].includes(latestVerification.status)),
  };
  const doneCount = SETUP_STEPS.filter((s) => done[s.key]).length;
  return { done, doneCount, total: SETUP_STEPS.length, latestVerification, nextStep: SETUP_STEPS.find((s) => !done[s.key])?.key ?? null };
}
