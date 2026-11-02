/**
 * Data-access contract used by route handlers. The production implementation talks to Supabase
 * (see supabase-store.ts); tests use an in-memory implementation. Route handlers never build SQL.
 */
export interface MeResult {
  profile: {
    id: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
    homeCityId: string | null;
    onboardingCompletedAt: string | null;
    tasteResetAt: string | null;
  };
  roles: string[];
  restaurants: { restaurantId: string; role: string; name: string }[];
  consents: Record<string, boolean>;
}

export interface DataStore {
  getMe(userId: string): Promise<MeResult | null>;
}
