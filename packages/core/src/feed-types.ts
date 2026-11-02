/** Shapes shared by the API (producer) and the mobile app (consumer). */

/** A ranking candidate, as returned by public.feed_candidates() (camelCased). */
export interface FeedCandidate {
  videoId: string;
  playbackUrl: string;
  thumbnailUrl: string | null;
  durationMs: number | null;
  caption: string | null;
  hashtags: string[];
  isSponsored: boolean;
  sponsorDisclosure: string | null;
  publishedAt: string;
  source: 'creator' | 'customer' | 'restaurant';
  uploaderId: string;
  creatorHandle: string | null;
  creatorDisplayName: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  restaurantSlug: string | null;
  cuisines: string[];
  priceLevel: number | null;
  halalCertified: boolean;
  locationId: string | null;
  suburb: string | null;
  distanceKm: number | null;
  isOpen: boolean;
  acceptingOrders: boolean;
  pickupEnabled: boolean;
  menuItemId: string | null;
  menuItemName: string | null;
  priceCents: number | null;
  currency: string | null;
  itemCuisine: string | null;
  itemCategory: string | null;
  itemTags: string[];
  dietaryTags: string[];
  /** Allergens the restaurant declared for the linked dish (if loaded). */
  itemAllergens?: string[];
  spiceLevel: number | null;
  itemAvailable: boolean;
  orderable: boolean;
  stats: { likes: number; comments: number; impressions: number; completions: number; rightSwipes: number; leftSwipes: number; orders: number };
}

export type NotOrderableReason = 'no_linked_item' | 'item_unavailable' | 'restaurant_closed' | 'not_accepting_orders' | 'pickup_unavailable';

export interface FeedItem {
  videoId: string;
  playbackUrl: string;
  thumbnailUrl: string | null;
  durationMs: number | null;
  caption: string | null;
  isSponsored: boolean;
  sponsorDisclosure: string | null;
  creator: { id: string; handle: string | null; displayName: string | null } | null;
  restaurant: {
    id: string; name: string; slug: string | null; cuisines: string[]; priceLevel: number | null;
    suburb: string | null; distanceKm: number | null; isOpen: boolean; halalCertified: boolean; locationId: string | null;
  } | null;
  menuItem: {
    id: string; name: string; priceCents: number; currency: string; dietaryTags: string[]; spiceLevel: number | null;
  } | null;
  orderable: boolean;
  notOrderableReason: NotOrderableReason | null;
  stats: { likes: number; comments: number };
  viewer: { liked: boolean; saved: boolean; craved: boolean; followingCreator?: boolean };
  ranking: { score: number; reasons: string[]; exploration: boolean } | null;
}

export interface FeedResponse {
  feedRequestId: string;
  modelVersion: string;
  personalised: boolean;
  items: FeedItem[];
}

export function notOrderableReason(c: FeedCandidate): NotOrderableReason | null {
  if (c.orderable) return null;
  if (!c.menuItemId) return 'no_linked_item';
  if (!c.itemAvailable) return 'item_unavailable';
  if (!c.acceptingOrders) return 'not_accepting_orders';
  if (!c.pickupEnabled) return 'pickup_unavailable';
  return 'restaurant_closed';
}

export function toFeedItem(c: FeedCandidate, viewer: FeedItem['viewer'], ranking: FeedItem['ranking'] = null): FeedItem {
  return {
    videoId: c.videoId,
    playbackUrl: c.playbackUrl,
    thumbnailUrl: c.thumbnailUrl,
    durationMs: c.durationMs,
    caption: c.caption,
    isSponsored: c.isSponsored,
    sponsorDisclosure: c.sponsorDisclosure,
    creator: c.source === 'restaurant' ? null : { id: c.uploaderId, handle: c.creatorHandle, displayName: c.creatorDisplayName },
    restaurant: c.restaurantId ? {
      id: c.restaurantId, name: c.restaurantName ?? '', slug: c.restaurantSlug, cuisines: c.cuisines, priceLevel: c.priceLevel,
      suburb: c.suburb, distanceKm: c.distanceKm == null ? null : Math.round(c.distanceKm * 10) / 10,
      isOpen: c.isOpen, halalCertified: c.halalCertified, locationId: c.locationId,
    } : null,
    menuItem: c.menuItemId && c.priceCents != null ? {
      id: c.menuItemId, name: c.menuItemName ?? '', priceCents: c.priceCents, currency: c.currency ?? 'AUD',
      dietaryTags: c.dietaryTags, spiceLevel: c.spiceLevel,
    } : null,
    orderable: c.orderable,
    notOrderableReason: notOrderableReason(c),
    stats: { likes: c.stats.likes, comments: c.stats.comments },
    viewer,
    ranking,
  };
}

export const NOT_ORDERABLE_COPY: Record<NotOrderableReason, string> = {
  no_linked_item: 'Not orderable from this video',
  item_unavailable: 'Sold out right now',
  restaurant_closed: 'Restaurant closed',
  not_accepting_orders: 'Not taking orders right now',
  pickup_unavailable: 'Pickup unavailable',
};
