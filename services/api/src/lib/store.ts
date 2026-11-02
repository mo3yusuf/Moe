/**
 * Data-access contract used by route handlers. The production implementation talks to Supabase
 * (see supabase-store.ts); tests use in-memory fakes. Route handlers never build SQL.
 */
import type { FeedCandidate } from '@crave/core';
import type { EventWritePlan } from './events';

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

export interface FeedQuery {
  cityId?: string;
  lat?: number;
  lng?: number;
  maxKm: number;
  limit: number;
}

export interface ViewerVideoState {
  liked: Set<string>;
  saved: Set<string>;
  craved: Set<string>;
}

export interface CravingRow {
  videoId: string | null;
  menuItemId: string | null;
  savedAt: string;
  collection: 'cravings' | 'saved';
  menuItemName: string | null;
  priceCents: number | null;
  currency: string | null;
  restaurantName: string | null;
  isAvailable: boolean;
}

export interface DataStore {
  getMe(userId: string): Promise<MeResult | null>;
  hasConsent(userId: string, consentType: string): Promise<boolean>;
  feedCandidates(q: FeedQuery): Promise<FeedCandidate[]>;
  viewerVideoState(userId: string, videoIds: string[]): Promise<ViewerVideoState>;
  latestSwipes(userId: string, videoIds: string[]): Promise<Map<string, 'right' | 'left'>>;
  applyEventPlan(userId: string, plan: EventWritePlan): Promise<void>;
  listSaved(userId: string, collection: 'cravings' | 'saved'): Promise<CravingRow[]>;
}
