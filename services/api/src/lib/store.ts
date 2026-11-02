/**
 * Data-access contract used by route handlers. The production implementation talks to Supabase
 * (see supabase-store.ts); tests use in-memory fakes. Route handlers never build SQL.
 */
import type { ExplicitPreferences, FeedCandidate, ItemDef, Quote, ServiceFeeConfig, Signal } from '@crave/core';
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

export interface RankingContext {
  signals: Signal[];
  impressions: { videoId: string; at: Date }[];
  resetAt: Date | null;
  preferences: ExplicitPreferences;
  /** Admin overrides from platform_settings.ranking_weights (validated before use). */
  weights: unknown;
}

export interface ImpressionRow {
  videoId: string;
  position: number;
  score: number;
  exploration: boolean;
  reasons: string[];
}

export interface RestaurantSummary {
  id: string; name: string; slug: string; description: string | null; logoUrl: string | null; coverUrl: string | null;
  cuisines: string[]; priceLevel: number; halalCertified: boolean; locationId: string | null; suburb: string | null;
  distanceKm: number | null; isOpen: boolean; acceptingOrders: boolean; videoCount: number; matchedItems: string[];
}

export interface VideoMenuEntry {
  menuItemId: string; section: string; name: string; description: string | null; priceCents: number; currency: string;
  imageUrl: string | null; dietaryTags: string[]; spiceLevel: number | null; isAvailable: boolean;
  videoId: string | null; playbackUrl: string | null; thumbnailUrl: string | null; hasOptions: boolean;
}

export interface RestaurantDetail {
  restaurant: Omit<RestaurantSummary, 'distanceKm' | 'matchedItems' | 'videoCount'> & {
    address: string | null; hours: { dayOfWeek: number; opensAt: string; closesAt: string }[]; acceptsAdvanceOrders: boolean;
  };
  menu: VideoMenuEntry[];
  following: boolean;
}

export interface MenuItemDetail {
  id: string; restaurantId: string; restaurantName: string; locationId: string | null; name: string; description: string | null;
  priceCents: number; currency: string; imageUrl: string | null; dietaryTags: string[]; allergens: string[]; spiceLevel: number | null;
  isAvailable: boolean; orderable: boolean;
  optionGroups: { id: string; name: string; minSelect: number; maxSelect: number; options: { id: string; name: string; priceDeltaCents: number; isAvailable: boolean }[] }[];
}

export interface ModerationVideo {
  id: string; uploaderId: string; caption: string | null; source: string; isSponsored: boolean; sponsorDisclosure: string | null;
  createdAt: string; durationMs: number | null; previewUrl: string | null; tags: { menuItemName: string; restaurantName: string; status: string }[];
  openReports: number;
}

export interface OrderableItemDef extends ItemDef {
  restaurantId: string;
  restaurantName: string;
  commissionRateBps: number;
  locationId: string | null;
  acceptsAdvanceOrders: boolean;
}

export interface BasketRow {
  id: string; restaurantId: string; locationId: string;
  items: { id: string; menuItemId: string; quantity: number; optionIds: string[]; notes: string | null; sourceVideoId: string | null }[];
}

export interface LocationStatus { isOpen: boolean; acceptingOrders: boolean; pickupEnabled: boolean; prepTimeMinutes: number }

export interface OrderView {
  id: string; orderNumber: string; status: string; restaurantId: string; restaurantName: string; pickupName: string;
  customerNote: string | null; scheduledFor: string | null; createdAt: string; placedAt: string | null; estimatedReadyAt: string | null;
  subtotalCents: number; serviceFeeCents: number; totalCents: number; gstCents: number; currency: string; cancelReason: string | null;
  pickupAddress: string | null;
  items: { name: string; quantity: number; unitPriceCents: number; lineTotalCents: number; options: { name: string }[]; notes: string | null }[];
  events: { status: string; at: string; note: string | null }[];
  refunds: { amountCents: number; status: string; reason: string }[];
  payment: { provider: string; status: string; isTestMode: boolean } | null;
}

export interface DataStore {
  getMe(userId: string): Promise<MeResult | null>;
  hasConsent(userId: string, consentType: string): Promise<boolean>;
  feedCandidates(q: FeedQuery): Promise<FeedCandidate[]>;
  viewerVideoState(userId: string, videoIds: string[]): Promise<ViewerVideoState>;
  latestSwipes(userId: string, videoIds: string[]): Promise<Map<string, 'right' | 'left'>>;
  applyEventPlan(userId: string, plan: EventWritePlan): Promise<void>;
  listSaved(userId: string, collection: 'cravings' | 'saved'): Promise<CravingRow[]>;
  loadRankingContext(userId: string, opts: { personalised: boolean; since: Date }): Promise<RankingContext>;
  recordImpressions(userId: string, feedRequestId: string, modelVersion: string, rows: ImpressionRow[]): Promise<void>;
  nearbyRestaurants(q: { lat?: number; lng?: number; maxKm: number; query?: string; limit: number }): Promise<RestaurantSummary[]>;
  logSearch(userId: string, query: string, resultCount: number): Promise<void>;
  restaurantDetail(restaurantId: string, userId: string): Promise<RestaurantDetail | null>;
  setFollow(userId: string, restaurantId: string, follow: boolean): Promise<void>;
  menuItemDetail(menuItemId: string): Promise<MenuItemDetail | null>;
  isAdmin(userId: string): Promise<boolean>;
  listVideosForModeration(status: 'pending_review' | 'published' | 'rejected', limit: number): Promise<ModerationVideo[]>;
  /** Publishes (copying the upload to the public playback bucket), rejects or removes a video. Audited. */
  moderateVideo(adminId: string, videoId: string, decision: 'publish' | 'reject' | 'remove', notes: string | null): Promise<'ok' | 'not_found' | 'missing_upload'>;
  itemDefs(menuItemIds: string[]): Promise<Map<string, OrderableItemDef>>;
  locationStatus(locationId: string, at?: Date): Promise<LocationStatus | null>;
  serviceFeeConfig(): Promise<ServiceFeeConfig>;
  getBasket(userId: string): Promise<BasketRow | null>;
  createBasket(userId: string, restaurantId: string, locationId: string): Promise<BasketRow>;
  abandonBasket(userId: string): Promise<void>;
  addBasketItem(basketId: string, item: { menuItemId: string; quantity: number; optionIds: string[]; notes: string | null; sourceVideoId: string | null }): Promise<void>;
  updateBasketItem(basketId: string, itemId: string, quantity: number): Promise<boolean>;
  removeBasketItem(basketId: string, itemId: string): Promise<boolean>;
  createPendingOrder(input: {
    userId: string; restaurantId: string; locationId: string; pickupName: string; note: string | null;
    scheduledFor: string | null; sourceVideoId: string | null; quote: Quote; idempotencyKey: string;
  }): Promise<{ id: string; orderNumber: string; status: string; totalCents: number }>;
  confirmPayment(orderId: string, provider: 'simulated' | 'stripe', providerRef: string, amountCents: number, applicationFeeCents: number, testMode: boolean): Promise<void>;
  listOrders(userId: string): Promise<OrderView[]>;
  getOrder(userId: string, orderId: string): Promise<OrderView | null>;
  // --- Payments (Phase 7) ---
  restaurantPayments(restaurantId: string): Promise<{ name: string; stripeAccountId: string | null; payoutsEnabled: boolean } | null>;
  isRestaurantOwner(userId: string, restaurantId: string): Promise<boolean>;
  setRestaurantStripeAccount(restaurantId: string, accountId: string): Promise<void>;
  recordPaymentIntent(orderId: string, intentId: string, amountCents: number, applicationFeeCents: number, testMode: boolean): Promise<void>;
  markPaymentFailed(intentId: string, reason: string): Promise<void>;
  expireUnpaidOrders(minutes: number): Promise<{ orderId: string; intentId: string | null }[]>;
  claimRefunds(limit: number): Promise<{ refundId: string; orderId: string; amountCents: number; provider: string; intentId: string | null; isTestMode: boolean; full: boolean }[]>;
  markRefundResult(refundId: string | null, providerRefundId: string | null, status: 'pending' | 'succeeded' | 'failed', failure?: string): Promise<void>;
  recordDispute(intentId: string, disputeId: string, amountCents: number, reason: string, status: string, evidenceDue: Date | null): Promise<void>;
  setRestaurantStripeStatus(accountId: string, chargesEnabled: boolean, payoutsEnabled: boolean): Promise<void>;
  upsertPayout(accountId: string, payoutId: string, amountCents: number, currency: string, status: string, arrival: string | null): Promise<void>;
  /** Returns false if this webhook event was already processed. */
  beginWebhook(eventId: string, type: string, payload: unknown): Promise<boolean>;
  finishWebhook(eventId: string, error: string | null): Promise<void>;
  paymentsForReconciliation(from: Date, to: Date): Promise<{ intentId: string; orderId: string; orderNumber: string; amountCents: number; status: string }[]>;
  // --- Trust & privacy ---
  blockedUserIds(userId: string): Promise<Set<string>>;
  deletionRequestsReady(limit: number): Promise<{ requestId: string; userId: string }[]>;
  /** Deletes the auth user (cascading personal data) and their uploaded files; orders are kept anonymised. */
  deleteUserAccount(requestId: string, userId: string): Promise<void>;
  runFraudRules(): Promise<number>;
  getPreferences(userId: string): Promise<ExplicitPreferences & { preferredFulfilment: 'pickup' | 'delivery' | null }>;
  setPreferences(userId: string, prefs: ExplicitPreferences & { preferredFulfilment: 'pickup' | 'delivery' | null }): Promise<void>;
}
