import {
  EMPTY_PREFERENCES,
  NOT_ORDERABLE_MESSAGES,
  distanceKm,
  emptyTasteProfile,
  hashSeed,
  rankFeed,
  type FeedCandidate,
  type LatLng,
  type RankedItem,
} from '@crave/core';
import type { Sql } from '../db';
import { activeRecommendationConfig } from './config';
import { loadVideoRows, marketIdForCode, rowOrderability, type VideoRow } from './catalog';
import { loadPreferences, loadTasteProfile, personalisationEnabled } from './taste';

export type FeedKind = 'for_you' | 'following' | 'nearby' | 'trending';

export interface FeedItemDto {
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

export interface FeedRequest {
  userId: string | null;
  kind: FeedKind;
  sessionId: string;
  location: LatLng | null;
  limit: number;
  /** Ids the client already has (needed for signed-out paging). */
  excludeVideoIds?: string[];
  marketCode?: string;
  now?: Date;
}

function toCandidate(row: VideoRow, location: LatLng | null, orderable: boolean): FeedCandidate {
  const cuisines = row.item_cuisine ? [row.item_cuisine] : row.restaurant_cuisines ?? [];
  return {
    videoId: row.video_id,
    menuItemId: row.menu_item_id,
    restaurantId: row.restaurant_id,
    creatorId: row.uploader_kind === 'creator' ? row.uploader_id : null,
    cuisines,
    category: row.food_category,
    tags: [...new Set([...(row.item_tags ?? []), ...row.hashtags])],
    priceCents: row.price_cents,
    distanceKm: location && row.lat !== null && row.lng !== null ? distanceKm(location, { lat: row.lat, lng: row.lng }) : null,
    orderable,
    publishedAt: row.published_at.toISOString(),
    trendingScore: row.trending_score ?? 0,
    verifiedDietary: [...new Set([...(row.restaurant_verified_dietary ?? [])])],
    spiceLevel: row.spice_level,
    isSponsored: row.is_sponsored,
  };
}

export async function buildFeed(sql: Sql, req: FeedRequest): Promise<{ items: FeedItemDto[]; configVersion: string }> {
  const now = req.now ?? new Date();
  const config = await activeRecommendationConfig(sql);
  const marketId = await marketIdForCode(sql, req.marketCode);

  const personalised = req.userId ? await personalisationEnabled(sql, req.userId) : false;
  const profile = req.userId && personalised ? await loadTasteProfile(sql, req.userId) : emptyTasteProfile();
  // Explicit preferences (dietary requirements etc.) always apply — they are the user's own settings.
  const prefs = req.userId ? await loadPreferences(sql, req.userId) : EMPTY_PREFERENCES;

  let followedUsers: string[] = [];
  let followedRestaurants: string[] = [];
  const served = new Set<string>(req.excludeVideoIds ?? []);
  const impressionCounts = new Map<string, number>();
  if (req.userId) {
    followedUsers = (await sql<{ id: string }[]>`select followee_id as id from public.user_follows where follower_id = ${req.userId}`).map((r) => r.id);
    followedRestaurants = (await sql<{ id: string }[]>`select restaurant_id as id from public.restaurant_follows where user_id = ${req.userId}`).map((r) => r.id);
    const imps = await sql<{ video_id: string; n: number; in_session: boolean }[]>`
      select video_id, count(*)::int as n, bool_or(feed_session_id = ${req.sessionId}) as in_session
      from public.recommendation_impressions
      where user_id = ${req.userId} and served_at > now() - interval '7 days'
      group by video_id`;
    for (const i of imps) {
      impressionCounts.set(i.video_id, i.n);
      if (i.in_session) served.add(i.video_id);
    }
  }

  if (req.kind === 'following' && followedUsers.length === 0 && followedRestaurants.length === 0) {
    return { items: [], configVersion: config.version };
  }

  const rows = await loadVideoRows(sql, {
    marketId,
    ...(req.kind === 'following' ? { uploaderIds: followedUsers, restaurantIds: followedRestaurants } : {}),
  });
  const rowById = new Map(rows.map((r) => [r.video_id, r]));
  const orderInfo = new Map(rows.map((r) => [r.video_id, rowOrderability(r, now)]));
  const candidates = rows
    .filter((r) => !served.has(r.video_id))
    .map((r) => toCandidate(r, req.location, orderInfo.get(r.video_id)!.orderable));

  let ranked: RankedItem[];
  if (req.kind === 'following') {
    // Following is chronological (minus anything hidden), not algorithmic.
    ranked = candidates
      .filter((c) => !profile.hiddenVideoIds.includes(c.videoId))
      .slice(0, req.limit)
      .map((c) => ({ candidate: c, score: 0, reasons: ['From someone you follow'], exploration: false }));
  } else if (req.kind === 'trending') {
    ranked = candidates
      .filter((c) => !profile.hiddenVideoIds.includes(c.videoId))
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, req.limit)
      .map((c) => ({ candidate: c, score: c.trendingScore, reasons: ['Trending in Brisbane'], exploration: false }));
  } else {
    ranked = rankFeed(
      candidates,
      profile,
      prefs,
      {
        now,
        timeZone: 'Australia/Brisbane',
        followedRestaurantIds: new Set(followedRestaurants),
        followedCreatorIds: new Set(followedUsers),
        impressionCounts,
        seed: hashSeed(`${req.userId ?? 'anon'}:${req.sessionId}:${served.size}`),
        orderableOnly: req.kind === 'nearby',
      },
      config,
      req.limit,
    );
    if (req.kind === 'nearby' && req.location) {
      ranked.sort((a, b) => (a.candidate.distanceKm ?? 99) - (b.candidate.distanceKm ?? 99));
    }
  }

  // Viewer state for the returned page.
  const ids = ranked.map((r) => r.candidate.videoId);
  const liked = new Set<string>();
  const saved = new Set<string>();
  if (req.userId && ids.length > 0) {
    for (const r of await sql<{ video_id: string }[]>`select video_id from public.video_likes where user_id = ${req.userId} and video_id in ${sql(ids)}`) liked.add(r.video_id);
    for (const r of await sql<{ video_id: string }[]>`select video_id from public.saved_meals where user_id = ${req.userId} and video_id in ${sql(ids)}`) saved.add(r.video_id);
  }

  const items: FeedItemDto[] = ranked.map((r) => {
    const row = rowById.get(r.candidate.videoId)!;
    const info = orderInfo.get(row.video_id)!;
    return {
      videoId: row.video_id,
      playbackUrl: row.playback_url,
      posterUrl: row.poster_url,
      durationMs: row.duration_ms,
      caption: row.caption,
      hashtags: row.hashtags,
      isSponsored: row.is_sponsored,
      sponsorDisclosure: row.sponsor_disclosure,
      isDemo: row.is_demo,
      stats: { likes: row.like_count, comments: row.comment_count, saves: row.save_count, shares: row.share_count },
      uploader: {
        id: row.uploader_id,
        kind: row.uploader_kind,
        displayName: row.uploader_display_name,
        username: row.uploader_username,
        avatarUrl: row.uploader_avatar_url,
      },
      restaurant: row.restaurant_id
        ? {
            id: row.restaurant_id,
            name: row.restaurant_name!,
            slug: row.restaurant_slug!,
            suburb: row.suburb,
            ratingAvg: row.rating_avg !== null ? Number(row.rating_avg) : null,
            ratingCount: row.rating_count ?? 0,
            distanceKm: r.candidate.distanceKm !== null ? Math.round(r.candidate.distanceKm * 10) / 10 : null,
            openNow: info.openNow,
          }
        : null,
      meal:
        row.menu_item_id && row.item_name && row.price_cents !== null
          ? { menuItemId: row.menu_item_id, name: row.item_name, priceCents: row.price_cents, currency: row.currency ?? 'AUD', imageUrl: row.item_image_url }
          : null,
      orderable: info.orderable,
      notOrderableReason: info.reason ? NOT_ORDERABLE_MESSAGES[info.reason] : null,
      reasons: r.reasons,
      viewer: {
        liked: liked.has(row.video_id),
        saved: saved.has(row.video_id),
        followsUploader: followedUsers.includes(row.uploader_id),
        followsRestaurant: row.restaurant_id ? followedRestaurants.includes(row.restaurant_id) : false,
      },
    };
  });

  // Log what we served (signed-in, personalisation on) for de-duplication and evaluation.
  if (req.userId && personalised && ranked.length > 0) {
    await sql`
      insert into public.recommendation_impressions ${sql(
        ranked.map((r, i) => ({
          user_id: req.userId,
          video_id: r.candidate.videoId,
          feed_session_id: req.sessionId,
          feed_kind: req.kind,
          position: served.size + i,
          score: Number.isFinite(r.score) ? r.score : 0,
          reasons: r.reasons,
          exploration: r.exploration,
          config_version: config.version,
        })),
      )}`;
  }

  return { items, configVersion: config.version };
}
