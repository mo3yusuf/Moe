import type { SupabaseClient } from '@supabase/supabase-js';
import type { DataStore, MeResult } from './store';

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Production DataStore backed by Supabase using the service role (server-side only). */
export function supabaseStore(admin: SupabaseClient): DataStore {
  return {
    async getMe(userId) {
      const profile = must(
        await admin.from('profiles')
          .select('id, display_name, username, avatar_url, home_city_id, onboarding_completed_at, taste_reset_at')
          .eq('id', userId).maybeSingle(),
        'profile');
      if (!profile) return null;
      const [roles, members, consents] = await Promise.all([
        admin.from('user_roles').select('role').eq('user_id', userId),
        admin.from('restaurant_members').select('restaurant_id, role, restaurants(name)').eq('user_id', userId),
        admin.from('current_privacy_consents').select('consent_type, granted').eq('user_id', userId),
      ]);
      const result: MeResult = {
        profile: {
          id: profile.id,
          displayName: profile.display_name,
          username: profile.username,
          avatarUrl: profile.avatar_url,
          homeCityId: profile.home_city_id,
          onboardingCompletedAt: profile.onboarding_completed_at,
          tasteResetAt: profile.taste_reset_at,
        },
        roles: (must(roles, 'roles') ?? []).map((r: { role: string }) => r.role),
        restaurants: (must(members, 'memberships') ?? []).map((m: any) => ({
          restaurantId: m.restaurant_id, role: m.role, name: m.restaurants?.name ?? '',
        })),
        consents: Object.fromEntries((must(consents, 'consents') ?? []).map((c: any) => [c.consent_type, c.granted])),
      };
      return result;
    },
  };
}
