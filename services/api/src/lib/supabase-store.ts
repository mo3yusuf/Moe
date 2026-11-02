import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedCandidate } from '@crave/core';
import type { DataStore, MeResult } from './store';

/** Maps a public.feed_candidates() row to the shared camelCase shape. */
export function mapCandidate(r: any): FeedCandidate {
  return {
    videoId: r.video_id, playbackUrl: r.playback_url, thumbnailUrl: r.thumbnail_url, durationMs: r.duration_ms,
    caption: r.caption, hashtags: r.hashtags ?? [], isSponsored: r.is_sponsored, sponsorDisclosure: r.sponsor_disclosure,
    publishedAt: r.published_at, source: r.source, uploaderId: r.uploader_id, creatorHandle: r.creator_handle,
    creatorDisplayName: r.creator_display_name, restaurantId: r.restaurant_id, restaurantName: r.restaurant_name,
    restaurantSlug: r.restaurant_slug, cuisines: r.cuisines ?? [], priceLevel: r.price_level, halalCertified: !!r.halal_certified,
    locationId: r.location_id, suburb: r.suburb, distanceKm: r.distance_km, isOpen: !!r.is_open,
    acceptingOrders: !!r.accepting_orders, pickupEnabled: !!r.pickup_enabled, menuItemId: r.menu_item_id,
    menuItemName: r.menu_item_name, priceCents: r.price_cents, currency: r.currency, itemCuisine: r.item_cuisine,
    itemCategory: r.item_category, itemTags: r.item_tags ?? [], dietaryTags: r.dietary_tags ?? [], spiceLevel: r.spice_level,
    itemAvailable: !!r.item_available, orderable: !!r.orderable,
    stats: {
      likes: Number(r.likes ?? 0), comments: Number(r.comments ?? 0), impressions: Number(r.impressions ?? 0),
      completions: Number(r.completions ?? 0), rightSwipes: Number(r.right_swipes ?? 0), leftSwipes: Number(r.left_swipes ?? 0),
      orders: Number(r.orders ?? 0),
    },
  };
}

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

    async hasConsent(userId, consentType) {
      const { data, error } = await admin.rpc('has_consent', { p_user_id: userId, p_type: consentType });
      if (error) throw new Error(`consent: ${error.message}`);
      return data === true;
    },

    async feedCandidates(q) {
      const { data, error } = await admin.rpc('feed_candidates', {
        p_city_id: q.cityId ?? null, p_lat: q.lat ?? null, p_lng: q.lng ?? null, p_max_km: q.maxKm, p_limit: q.limit,
      });
      if (error) throw new Error(`feed_candidates: ${error.message}`);
      return (data ?? []).map(mapCandidate);
    },

    async viewerVideoState(userId, videoIds) {
      if (!videoIds.length) return { liked: new Set(), saved: new Set(), craved: new Set() };
      const [likes, saved] = await Promise.all([
        admin.from('video_likes').select('video_id').eq('user_id', userId).in('video_id', videoIds),
        admin.from('saved_meals').select('video_id, collection').eq('user_id', userId).in('video_id', videoIds),
      ]);
      const savedRows = (must(saved, 'saved') ?? []) as { video_id: string; collection: string }[];
      return {
        liked: new Set((must(likes, 'likes') ?? []).map((r: any) => r.video_id)),
        saved: new Set(savedRows.filter((r) => r.collection === 'saved').map((r) => r.video_id)),
        craved: new Set(savedRows.filter((r) => r.collection === 'cravings').map((r) => r.video_id)),
      };
    },

    async latestSwipes(userId, videoIds) {
      const out = new Map<string, 'right' | 'left'>();
      if (!videoIds.length) return out;
      const { data, error } = await admin.from('swipe_events').select('video_id, direction, created_at')
        .eq('user_id', userId).in('video_id', videoIds).order('created_at', { ascending: false });
      if (error) throw new Error(`swipes: ${error.message}`);
      for (const r of data ?? []) if (!out.has(r.video_id)) out.set(r.video_id, r.direction);
      return out;
    },

    async applyEventPlan(userId, plan) {
      const ops: PromiseLike<{ error: { message: string } | null }>[] = [];
      if (plan.swipes.length) {
        ops.push(admin.from('swipe_events').upsert(plan.swipes.map((s) => ({
          user_id: userId, client_event_id: s.clientEventId, video_id: s.videoId, menu_item_id: s.menuItemId,
          direction: s.direction, input_method: s.inputMethod, feed_request_id: s.feedRequestId, created_at: s.createdAt,
        })), { onConflict: 'user_id,client_event_id', ignoreDuplicates: true }));
      }
      if (plan.interactions.length) {
        ops.push(admin.from('video_interactions').upsert(plan.interactions.map((i) => ({
          user_id: userId, client_event_id: i.clientEventId, video_id: i.videoId, menu_item_id: i.menuItemId,
          event_type: i.eventType, watch_ms: i.watchMs, completion_pct: i.completionPct, feed_request_id: i.feedRequestId,
          created_at: i.createdAt,
        })), { onConflict: 'user_id,client_event_id', ignoreDuplicates: true }));
      }
      const upsertSaved = (rows: { videoId: string; menuItemId: string | null }[], collection: string) => {
        for (const r of rows) {
          ops.push(admin.from('saved_meals').delete().eq('user_id', userId).eq('collection', collection).eq('video_id', r.videoId)
            .then(() => admin.from('saved_meals').insert({ user_id: userId, collection, video_id: r.videoId, menu_item_id: r.menuItemId })));
        }
      };
      upsertSaved(plan.cravingsAdd, 'cravings');
      upsertSaved(plan.savedAdd, 'saved');
      if (plan.cravingsRemove.length) ops.push(admin.from('saved_meals').delete().eq('user_id', userId).eq('collection', 'cravings').in('video_id', plan.cravingsRemove));
      if (plan.savedRemove.length) ops.push(admin.from('saved_meals').delete().eq('user_id', userId).eq('collection', 'saved').in('video_id', plan.savedRemove));
      if (plan.likesAdd.length) ops.push(admin.from('video_likes').upsert(plan.likesAdd.map((v) => ({ user_id: userId, video_id: v })), { onConflict: 'user_id,video_id', ignoreDuplicates: true }));
      if (plan.likesRemove.length) ops.push(admin.from('video_likes').delete().eq('user_id', userId).in('video_id', plan.likesRemove));
      for (const [videoId, d] of plan.stats) {
        ops.push(admin.rpc('bump_video_stats', {
          p_video_id: videoId, p_impressions: d.impressions, p_views_3s: d.views3s, p_completions: d.completions,
          p_shares: d.shares, p_right_swipes: d.rightSwipes, p_left_swipes: d.leftSwipes, p_order_clicks: d.orderClicks,
        }));
      }
      const results = await Promise.all(ops);
      const failed = results.find((r) => r?.error);
      if (failed?.error) throw new Error(`apply events: ${failed.error.message}`);
    },

    async listSaved(userId, collection) {
      const { data, error } = await admin.from('saved_meals').select('video_id, menu_item_id, created_at, collection, menu_items(name, price_cents, currency, is_available, restaurants(name))')
        .eq('user_id', userId).eq('collection', collection).order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error(`saved: ${error.message}`);
      return (data ?? []).map((r: any) => ({
        videoId: r.video_id, menuItemId: r.menu_item_id, savedAt: r.created_at, collection: r.collection,
        menuItemName: r.menu_items?.name ?? null, priceCents: r.menu_items?.price_cents ?? null,
        currency: r.menu_items?.currency ?? null, restaurantName: r.menu_items?.restaurants?.name ?? null,
        isAvailable: !!r.menu_items?.is_available,
      }));
    },
  };
}
