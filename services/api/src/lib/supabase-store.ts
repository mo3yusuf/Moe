import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_PREFERENCES, parseServiceFeeConfig, type DietaryTag, type ExplicitPreferences, type FeedCandidate, type Signal } from '@crave/core';
import type { BasketRow, DataStore, MeResult, OrderView } from './store';

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
  const store: DataStore = {
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

    async loadRankingContext(userId, { personalised, since }) {
      const prefsP = store.getPreferences(userId);
      const weightsP = admin.from('platform_settings').select('value').eq('key', 'ranking_weights').maybeSingle();
      if (!personalised) {
        const [preferences, weights] = await Promise.all([prefsP, weightsP]);
        return { signals: [], impressions: [], resetAt: null, preferences, weights: weights.data?.value ?? null };
      }
      const [preferences, weights, profile, signals, impressions] = await Promise.all([
        prefsP, weightsP,
        admin.from('profiles').select('taste_reset_at').eq('id', userId).maybeSingle(),
        admin.rpc('user_ranking_signals', { p_user_id: userId, p_since: since.toISOString() }),
        admin.from('recommendation_impressions').select('video_id, created_at').eq('user_id', userId)
          .gte('created_at', new Date(Date.now() - 3 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(500),
      ]);
      if (signals.error) throw new Error(`signals: ${signals.error.message}`);
      return {
        preferences,
        weights: weights.data?.value ?? null,
        resetAt: profile.data?.taste_reset_at ? new Date(profile.data.taste_reset_at) : null,
        impressions: (impressions.data ?? []).map((r: any) => ({ videoId: r.video_id, at: new Date(r.created_at) })),
        signals: (signals.data ?? []).map((r: any): Signal => ({
          kind: r.kind, at: new Date(r.at), videoId: r.video_id, menuItemId: r.menu_item_id,
          watchMs: r.watch_ms, completionPct: r.completion_pct,
          item: {
            restaurantId: r.restaurant_id, cuisine: r.cuisine, category: r.category, tags: r.tags ?? [],
            priceLevel: r.price_level, priceCents: r.price_cents, creatorId: r.creator_id, halalCertified: !!r.halal_certified,
          },
        })),
      };
    },

    async recordImpressions(userId, feedRequestId, modelVersion, rows) {
      if (!rows.length) return;
      const { error } = await admin.from('recommendation_impressions').insert(rows.map((r) => ({
        user_id: userId, video_id: r.videoId, feed_request_id: feedRequestId, position: r.position,
        score: r.score, model_version: modelVersion, is_exploration: r.exploration, reasons: r.reasons,
      })));
      if (error) throw new Error(`impressions: ${error.message}`);
    },

    async getPreferences(userId) {
      const { data, error } = await admin.from('user_taste_preferences').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`preferences: ${error.message}`);
      if (!data) return { ...EMPTY_PREFERENCES, preferredFulfilment: null };
      return {
        favouriteCuisines: data.favourite_cuisines ?? [], dislikedCuisines: data.disliked_cuisines ?? [],
        dietaryRequirements: (data.dietary_requirements ?? []) as DietaryTag[], spicePreference: data.spice_preference,
        typicalBudgetCents: data.typical_budget_cents, preferredFulfilment: data.preferred_fulfilment,
      };
    },

    async setPreferences(userId, p) {
      const { error } = await admin.from('user_taste_preferences').upsert({
        user_id: userId, favourite_cuisines: p.favouriteCuisines, disliked_cuisines: p.dislikedCuisines,
        dietary_requirements: p.dietaryRequirements, spice_preference: p.spicePreference,
        typical_budget_cents: p.typicalBudgetCents, preferred_fulfilment: p.preferredFulfilment,
      });
      if (error) throw new Error(`preferences: ${error.message}`);
      await admin.from('profiles').update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', userId).is('onboarding_completed_at', null);
    },

    async nearbyRestaurants(q) {
      const { data, error } = await admin.rpc('nearby_restaurants', {
        p_lat: q.lat ?? null, p_lng: q.lng ?? null, p_max_km: q.maxKm, p_query: q.query ?? null, p_limit: q.limit,
      });
      if (error) throw new Error(`nearby: ${error.message}`);
      return (data ?? []).map((r: any) => ({
        id: r.restaurant_id, name: r.name, slug: r.slug, description: r.description, logoUrl: r.logo_url, coverUrl: r.cover_url,
        cuisines: r.cuisines ?? [], priceLevel: r.price_level, halalCertified: !!r.halal_certified, locationId: r.location_id,
        suburb: r.suburb, distanceKm: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10, isOpen: !!r.is_open,
        acceptingOrders: !!r.accepting_orders, videoCount: Number(r.video_count ?? 0), matchedItems: r.matched_items ?? [],
      }));
    },

    async logSearch(userId, query, resultCount) {
      await admin.from('search_events').insert({ user_id: userId, query: query.slice(0, 100), result_count: resultCount });
    },

    async restaurantDetail(restaurantId, userId) {
      const { data: r, error } = await admin.from('restaurants')
        .select('id, name, slug, description, logo_url, cover_url, cuisines, price_level, accepts_advance_orders, status, restaurant_locations(id, address_line1, suburb, region, postcode, is_accepting_orders, location_opening_hours(day_of_week, opens_at, closes_at)), restaurant_certifications(certification, verified_at)')
        .eq('id', restaurantId).maybeSingle();
      if (error) throw new Error(`restaurant: ${error.message}`);
      if (!r || r.status !== 'verified') return null;
      const loc: any = (r as any).restaurant_locations?.[0] ?? null;
      const [menu, follow, open] = await Promise.all([
        admin.rpc('restaurant_video_menu', { p_restaurant_id: restaurantId }),
        admin.from('restaurant_follows').select('user_id').eq('user_id', userId).eq('restaurant_id', restaurantId).maybeSingle(),
        loc ? admin.rpc('location_is_open', { p_location_id: loc.id }) : Promise.resolve({ data: false }),
      ]);
      if (menu.error) throw new Error(`menu: ${menu.error.message}`);
      return {
        restaurant: {
          id: r.id, name: r.name, slug: r.slug, description: r.description, logoUrl: r.logo_url, coverUrl: r.cover_url,
          cuisines: r.cuisines ?? [], priceLevel: r.price_level, acceptsAdvanceOrders: r.accepts_advance_orders,
          halalCertified: ((r as any).restaurant_certifications ?? []).some((c: any) => c.certification === 'halal' && c.verified_at),
          locationId: loc?.id ?? null, suburb: loc?.suburb ?? null, isOpen: !!open.data, acceptingOrders: !!loc?.is_accepting_orders,
          address: loc ? `${loc.address_line1}, ${loc.suburb} ${loc.region} ${loc.postcode}` : null,
          hours: (loc?.location_opening_hours ?? []).map((h: any) => ({ dayOfWeek: h.day_of_week, opensAt: h.opens_at.slice(0, 5), closesAt: h.closes_at.slice(0, 5) }))
            .sort((a: any, b: any) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt)),
        },
        menu: (menu.data ?? []).map((m: any) => ({
          menuItemId: m.menu_item_id, section: m.section, name: m.name, description: m.description, priceCents: m.price_cents,
          currency: m.currency, imageUrl: m.image_url, dietaryTags: m.dietary_tags ?? [], spiceLevel: m.spice_level,
          isAvailable: m.is_available, videoId: m.video_id, playbackUrl: m.playback_url, thumbnailUrl: m.thumbnail_url, hasOptions: m.has_options,
        })),
        following: !!follow.data,
      };
    },

    async setFollow(userId, restaurantId, follow) {
      const res = follow
        ? await admin.from('restaurant_follows').upsert({ user_id: userId, restaurant_id: restaurantId }, { onConflict: 'user_id,restaurant_id', ignoreDuplicates: true })
        : await admin.from('restaurant_follows').delete().eq('user_id', userId).eq('restaurant_id', restaurantId);
      if (res.error) throw new Error(`follow: ${res.error.message}`);
    },

    async menuItemDetail(menuItemId) {
      const { data: m, error } = await admin.from('menu_items')
        .select('id, restaurant_id, name, description, price_cents, currency, image_url, dietary_tags, allergens, spice_level, is_available, restaurants(name, status, restaurant_locations(id)), menu_item_option_groups(id, name, min_select, max_select, sort_order, menu_item_options(id, name, price_delta_cents, is_available, sort_order))')
        .eq('id', menuItemId).maybeSingle();
      if (error) throw new Error(`menu item: ${error.message}`);
      const rest: any = (m as any)?.restaurants;
      if (!m || rest?.status !== 'verified') return null;
      const locationId = rest.restaurant_locations?.[0]?.id ?? null;
      const orderable = locationId ? (await admin.rpc('menu_item_orderable', { p_menu_item_id: m.id, p_location_id: locationId })).data === true : false;
      return {
        id: m.id, restaurantId: m.restaurant_id, restaurantName: rest.name, locationId, name: m.name, description: m.description,
        priceCents: m.price_cents, currency: m.currency, imageUrl: m.image_url, dietaryTags: m.dietary_tags ?? [], allergens: m.allergens ?? [],
        spiceLevel: m.spice_level, isAvailable: m.is_available, orderable,
        optionGroups: ((m as any).menu_item_option_groups ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((g: any) => ({
          id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select,
          options: (g.menu_item_options ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((o: any) => ({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents, isAvailable: o.is_available })),
        })),
      };
    },

    async isAdmin(userId) {
      const { data } = await admin.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
      return !!data;
    },

    async listVideosForModeration(status, limit) {
      const { data, error } = await admin.from('videos')
        .select('id, uploader_id, caption, source, is_sponsored, sponsor_disclosure, created_at, duration_ms, storage_path, video_menu_items(status, menu_items(name), restaurants(name))')
        .eq('status', status).order('created_at', { ascending: true }).limit(limit);
      if (error) throw new Error(`moderation list: ${error.message}`);
      const ids = (data ?? []).map((v) => v.id);
      const reports = ids.length ? await admin.from('content_reports').select('target_id').eq('target_type', 'video').eq('status', 'open').in('target_id', ids) : { data: [] };
      return Promise.all((data ?? []).map(async (v: any) => {
        const signed = v.storage_path ? await admin.storage.from('video-uploads').createSignedUrl(v.storage_path, 3600) : null;
        return {
          id: v.id, uploaderId: v.uploader_id, caption: v.caption, source: v.source, isSponsored: v.is_sponsored,
          sponsorDisclosure: v.sponsor_disclosure, createdAt: v.created_at, durationMs: v.duration_ms,
          previewUrl: signed?.data?.signedUrl ?? null,
          tags: (v.video_menu_items ?? []).map((t: any) => ({ menuItemName: t.menu_items?.name ?? '', restaurantName: t.restaurants?.name ?? '', status: t.status })),
          openReports: (reports.data ?? []).filter((r: any) => r.target_id === v.id).length,
        };
      }));
    },

    async moderateVideo(adminId, videoId, decision, notes) {
      const { data: v } = await admin.from('videos').select('id, storage_path, status').eq('id', videoId).maybeSingle();
      if (!v) return 'not_found';
      const update: Record<string, unknown> = { moderation_notes: notes };
      if (decision === 'publish') {
        if (!v.storage_path) return 'missing_upload';
        // Copy the private upload to the public playback bucket. A streaming provider (HLS) replaces this step later.
        const dest = `${videoId}.mp4`;
        await admin.storage.from('video-playback').remove([dest]); // copy() does not overwrite
        const { error: cpErr } = await admin.storage.from('video-uploads').copy(v.storage_path, dest, { destinationBucket: 'video-playback' });
        if (cpErr) return /not.?found/i.test(cpErr.message) ? 'missing_upload' : Promise.reject(new Error(`publish copy: ${cpErr.message}`));
        update.playback_url = admin.storage.from('video-playback').getPublicUrl(dest).data.publicUrl;
        update.status = 'published';
        update.published_at = new Date().toISOString();
      } else {
        update.status = decision === 'reject' ? 'rejected' : 'removed';
        if (v.status === 'published') await admin.storage.from('video-playback').remove([`${videoId}.mp4`]);
      }
      const { error } = await admin.from('videos').update(update).eq('id', videoId);
      if (error) throw new Error(`moderate: ${error.message}`);
      await admin.from('audit_log').insert({ actor_id: adminId, action: `video_${decision}`, entity_type: 'video', entity_id: videoId, details: { notes } });
      return 'ok';
    },

    async itemDefs(ids) {
      const out = new Map();
      if (!ids.length) return out;
      const { data, error } = await admin.from('menu_items')
        .select('id, name, price_cents, is_available, gst_applicable, restaurant_id, restaurants(name, status, commission_rate_bps, accepts_advance_orders, restaurant_locations(id)), menu_item_option_groups(id, name, min_select, max_select, menu_item_options(id, name, price_delta_cents, is_available))')
        .in('id', ids);
      if (error) throw new Error(`items: ${error.message}`);
      for (const m of (data ?? []) as any[]) {
        if (m.restaurants?.status !== 'verified') continue;
        out.set(m.id, {
          id: m.id, name: m.name, priceCents: m.price_cents, isAvailable: m.is_available, gstApplicable: m.gst_applicable,
          restaurantId: m.restaurant_id, restaurantName: m.restaurants.name, commissionRateBps: m.restaurants.commission_rate_bps,
          acceptsAdvanceOrders: m.restaurants.accepts_advance_orders, locationId: m.restaurants.restaurant_locations?.[0]?.id ?? null,
          optionGroups: (m.menu_item_option_groups ?? []).map((g: any) => ({
            id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select,
            options: (g.menu_item_options ?? []).map((o: any) => ({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents, isAvailable: o.is_available })),
          })),
        });
      }
      return out;
    },

    async locationStatus(locationId, at) {
      const { data } = await admin.from('restaurant_locations').select('is_accepting_orders, pickup_enabled, prep_time_minutes').eq('id', locationId).maybeSingle();
      if (!data) return null;
      const open = await admin.rpc('location_is_open', { p_location_id: locationId, p_at: (at ?? new Date()).toISOString() });
      return { isOpen: open.data === true, acceptingOrders: data.is_accepting_orders, pickupEnabled: data.pickup_enabled, prepTimeMinutes: data.prep_time_minutes };
    },

    async serviceFeeConfig() {
      const { data } = await admin.from('platform_settings').select('value').eq('key', 'service_fee').maybeSingle();
      return parseServiceFeeConfig(data?.value);
    },

    async getBasket(userId) {
      const { data, error } = await admin.from('baskets').select('id, restaurant_id, location_id, basket_items(id, menu_item_id, quantity, option_ids, notes, source_video_id, created_at)')
        .eq('user_id', userId).eq('status', 'active').maybeSingle();
      if (error) throw new Error(`basket: ${error.message}`);
      if (!data) return null;
      return toBasket(data);
    },

    async createBasket(userId, restaurantId, locationId) {
      const { data, error } = await admin.from('baskets').insert({ user_id: userId, restaurant_id: restaurantId, location_id: locationId }).select('id, restaurant_id, location_id').single();
      if (error) throw new Error(`basket: ${error.message}`);
      return toBasket({ ...data, basket_items: [] });
    },

    async abandonBasket(userId) {
      await admin.from('baskets').update({ status: 'abandoned' }).eq('user_id', userId).eq('status', 'active');
    },

    async addBasketItem(basketId, i) {
      const { error } = await admin.from('basket_items').insert({
        basket_id: basketId, menu_item_id: i.menuItemId, quantity: i.quantity, option_ids: i.optionIds, notes: i.notes, source_video_id: i.sourceVideoId,
      });
      if (error) throw new Error(`basket item: ${error.message}`);
    },

    async updateBasketItem(basketId, itemId, quantity) {
      const { data, error } = await admin.from('basket_items').update({ quantity }).eq('id', itemId).eq('basket_id', basketId).select('id');
      if (error) throw new Error(`basket item: ${error.message}`);
      return !!data?.length;
    },

    async removeBasketItem(basketId, itemId) {
      const { data, error } = await admin.from('basket_items').delete().eq('id', itemId).eq('basket_id', basketId).select('id');
      if (error) throw new Error(`basket item: ${error.message}`);
      return !!data?.length;
    },

    async createPendingOrder(i) {
      const { data, error } = await admin.rpc('create_pending_order', {
        p_user_id: i.userId, p_restaurant_id: i.restaurantId, p_location_id: i.locationId, p_pickup_name: i.pickupName,
        p_note: i.note, p_scheduled_for: i.scheduledFor, p_source_video_id: i.sourceVideoId, p_quote: i.quote, p_idempotency_key: i.idempotencyKey,
      }).single();
      if (error) throw new Error(`create order: ${error.message}`);
      const o = data as any;
      return { id: o.id, orderNumber: o.order_number, status: o.status, totalCents: o.total_cents };
    },

    async confirmPayment(orderId, provider, providerRef, amountCents, applicationFeeCents, testMode) {
      const { error } = await admin.rpc('confirm_order_payment', {
        p_order_id: orderId, p_provider: provider, p_provider_ref: providerRef, p_amount_cents: amountCents,
        p_application_fee_cents: applicationFeeCents, p_test_mode: testMode,
      });
      if (error) throw new Error(`confirm payment: ${error.message}`);
    },

    async listOrders(userId) {
      const { data, error } = await admin.from('orders').select(ORDER_SELECT).eq('user_id', userId).neq('status', 'pending_payment')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw new Error(`orders: ${error.message}`);
      return (data ?? []).map(toOrderView);
    },

    async getOrder(userId, orderId) {
      const { data, error } = await admin.from('orders').select(ORDER_SELECT).eq('id', orderId).eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`order: ${error.message}`);
      return data ? toOrderView(data) : null;
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
  return store;
}

const ORDER_SELECT = 'id, order_number, status, restaurant_id, pickup_name, customer_note, scheduled_for, created_at, placed_at, estimated_ready_at, subtotal_cents, service_fee_cents, total_cents, gst_cents, currency, cancel_reason, restaurants(name), restaurant_locations(address_line1, suburb, postcode), order_items(name, quantity, unit_price_cents, line_total_cents, options, notes), order_status_events(to_status, created_at, note), refunds(amount_cents, status, reason), payments(provider, status, is_test_mode)';

function toBasket(b: any): BasketRow {
  return {
    id: b.id, restaurantId: b.restaurant_id, locationId: b.location_id,
    items: [...(b.basket_items ?? [])].sort((x: any, y: any) => String(x.created_at).localeCompare(String(y.created_at))).map((i: any) => ({
      id: i.id, menuItemId: i.menu_item_id, quantity: i.quantity, optionIds: i.option_ids ?? [], notes: i.notes, sourceVideoId: i.source_video_id,
    })),
  };
}

function toOrderView(o: any): OrderView {
  const loc = o.restaurant_locations;
  const pay = (o.payments ?? [])[0];
  return {
    id: o.id, orderNumber: o.order_number, status: o.status, restaurantId: o.restaurant_id, restaurantName: o.restaurants?.name ?? '',
    pickupName: o.pickup_name, customerNote: o.customer_note, scheduledFor: o.scheduled_for, createdAt: o.created_at, placedAt: o.placed_at,
    estimatedReadyAt: o.estimated_ready_at, subtotalCents: o.subtotal_cents, serviceFeeCents: o.service_fee_cents, totalCents: o.total_cents,
    gstCents: o.gst_cents, currency: o.currency, cancelReason: o.cancel_reason,
    pickupAddress: loc ? `${loc.address_line1}, ${loc.suburb} ${loc.postcode}` : null,
    items: (o.order_items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, unitPriceCents: i.unit_price_cents, lineTotalCents: i.line_total_cents, options: (i.options ?? []).map((x: any) => ({ name: x.name })), notes: i.notes })),
    events: (o.order_status_events ?? []).map((e: any) => ({ status: e.to_status, at: e.created_at, note: e.note })).sort((a: any, b: any) => a.at.localeCompare(b.at)),
    refunds: (o.refunds ?? []).map((r: any) => ({ amountCents: r.amount_cents, status: r.status, reason: r.reason })),
    payment: pay ? { provider: pay.provider, status: pay.status, isTestMode: pay.is_test_mode } : null,
  };
}
