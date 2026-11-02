import { config } from './env';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Can’t reach CRAVE right now. Check your connection.');
  }
  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? 'Something went wrong');
  return json as T;
}

// --------------------------------------------------------------------------
// DTOs (mirror apps/api/src/services/feed.ts)
// --------------------------------------------------------------------------
export type FeedKind = 'for_you' | 'following' | 'nearby' | 'trending';

export interface FeedItem {
  videoId: string;
  playbackUrl: string | null;
  posterUrl: string | null;
  durationMs: number | null;
  caption: string;
  hashtags: string[];
  isSponsored: boolean;
  sponsorDisclosure: string | null;
  isDemo: boolean;
  stats: { likes: number; comments: number; saves: number; shares: number };
  uploader: { id: string; kind: 'creator' | 'restaurant'; displayName: string | null; username: string | null; avatarUrl: string | null };
  restaurant: { id: string; name: string; slug: string; suburb: string | null; ratingAvg: number | null; ratingCount: number; distanceKm: number | null; openNow: boolean } | null;
  meal: { menuItemId: string; name: string; priceCents: number; currency: string; imageUrl: string | null } | null;
  orderable: boolean;
  notOrderableReason: string | null;
  reasons: string[];
  viewer: { liked: boolean; saved: boolean; followsUploader: boolean; followsRestaurant: boolean };
}

export interface FeedResponse {
  items: FeedItem[];
  configVersion: string;
}

export function fetchFeed(params: { kind: FeedKind; session: string; limit?: number; exclude?: string[]; lat?: number; lng?: number }) {
  const q = new URLSearchParams({ kind: params.kind, session: params.session, limit: String(params.limit ?? 8) });
  if (params.exclude?.length) q.set('exclude', params.exclude.slice(-200).join(','));
  if (params.lat !== undefined && params.lng !== undefined) {
    q.set('lat', params.lat.toFixed(2));
    q.set('lng', params.lng.toFixed(2));
  }
  return api<FeedResponse>(`/v1/feed?${q.toString()}`);
}

export interface TasteProfileResponse {
  summary: {
    signalCount: number;
    likedCuisines: { key: string; score: number }[];
    lessInterestedCuisines: { key: string; score: number }[];
    likedTags: { key: string; score: number }[];
    hiddenVideoCount: number;
    typicalItemPriceCents: number | null;
    pickupOrders: number;
  };
  dataUsed: string[];
  notUsed: string[];
}

export interface RestaurantSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cuisines: string[];
  ratingAvg: number | null;
  ratingCount: number;
  isDemo: boolean;
  verifiedDietary: string[];
  acceptingOrders: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  acceptsAdvanceOrders: boolean;
  avgPrepMinutes: number;
  openNow: boolean;
  hours: { dayOfWeek: number; opensAt: string; closesAt: string }[];
  location: { id: string; address: string; suburb: string; lat: number; lng: number; pickupInstructions: string | null };
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { id: string; name: string; priceDeltaCents: number; available: boolean; isDefault: boolean }[];
}

export interface MenuItemResponse {
  item: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    imageUrl: string | null;
    dietary: string[];
    allergens: string[];
    spiceLevel: number | null;
    modifierGroups: ModifierGroup[];
  };
  restaurant: RestaurantSummary;
  orderable: boolean;
  notOrderableReason: string | null;
}

export interface RestaurantMenuResponse {
  restaurant: RestaurantSummary;
  categories: {
    id: string;
    name: string;
    items: { id: string; name: string; description: string | null; priceCents: number; available: boolean; imageUrl: string | null; dietary: string[]; spiceLevel: number | null; videoIds: string[] }[];
  }[];
}
