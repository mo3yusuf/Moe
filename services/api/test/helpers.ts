import { createApp, type AppDeps } from '../src/app';
import type { AuthVerifier } from '../src/lib/auth';
import type { DataStore } from '../src/lib/store';
import { recencyRanker } from '../src/lib/ranker';

/** Token format for tests: "test:<userId>". Anything else is rejected. */
export const fakeAuth: AuthVerifier = {
  async verify(token) {
    return token.startsWith('test:') ? { id: token.slice(5) } : null;
  },
};

export function makeApp(store: Partial<DataStore>, extra: Partial<AppDeps> = {}) {
  return createApp({ auth: fakeAuth, store: store as DataStore, ranker: recencyRanker, paymentsMode: 'simulated', corsOrigins: ['http://localhost:3000'], ...extra });
}

export const authed = (userId: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { Authorization: `Bearer test:${userId}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});

import type { FeedCandidate } from '@crave/core';
let seq = 0;
export function candidate(over: Partial<FeedCandidate> = {}): FeedCandidate {
  seq += 1;
  const n = String(seq).padStart(12, '0');
  return {
    videoId: `00000000-0000-4000-8000-${n}`, playbackUrl: 'https://example.com/v.mp4', thumbnailUrl: null, durationMs: 15000,
    caption: `video ${seq}`, hashtags: [], isSponsored: false, sponsorDisclosure: null,
    publishedAt: new Date(Date.UTC(2026, 10, 1, 0, seq)).toISOString(), source: 'creator',
    uploaderId: '00000000-0000-4000-8000-0000000000aa', creatorHandle: 'tester', creatorDisplayName: 'Tester',
    restaurantId: '00000000-0000-4000-8000-0000000000r1'.replace('r1', 'b1'), restaurantName: 'Test Burgers', restaurantSlug: 'test-burgers',
    cuisines: ['american'], priceLevel: 2, halalCertified: false, locationId: '00000000-0000-4000-8000-0000000000c1',
    suburb: 'Fortitude Valley', distanceKm: 2.34, isOpen: true, acceptingOrders: true, pickupEnabled: true,
    menuItemId: `10000000-0000-4000-8000-${n}`, menuItemName: 'Burger', priceCents: 1690, currency: 'AUD',
    itemCuisine: 'american', itemCategory: 'burger', itemTags: ['beef'], dietaryTags: [], spiceLevel: 0, itemAvailable: true,
    orderable: true, stats: { likes: 0, comments: 0, impressions: 0, completions: 0, rightSwipes: 0, leftSwipes: 0, orders: 0 },
    ...over,
  };
}
