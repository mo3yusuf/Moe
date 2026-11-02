import {
  buildTasteProfile, collaborativeScores, emptyProfile, LAUNCH_CITY, mergeRankingConfig, rankFeed,
  type FeedCandidate, type FeedItem,
} from '@crave/core';
import type { DataStore } from './store';

export interface RankRequest {
  userId: string;
  personalised: boolean;
  candidates: FeedCandidate[];
  limit: number;
  now: Date;
}

export interface RankResult {
  feedRequestId: string;
  modelVersion: string;
  items: { candidate: FeedCandidate; ranking: FeedItem['ranking'] }[];
}

/** The ranking service boundary. Implementations can be swapped (rules engine today, ML model later). */
export interface Ranker {
  rank(req: RankRequest): Promise<RankResult>;
}

/** Phase 2 baseline: newest first, orderable content preferred. */
export const recencyRanker: Ranker = {
  async rank({ candidates, limit }) {
    const items = [...candidates]
      .sort((a, b) => Number(b.orderable) - Number(a.orderable) || b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit)
      .map((candidate) => ({ candidate, ranking: null }));
    return { feedRequestId: crypto.randomUUID(), modelVersion: 'recency-v0', items };
  },
};


/**
 * Production ranker: transparent weighted rules over the user's own signals (see @crave/core
 * recommend/). Impressions are logged (with consent) so ranking quality can be evaluated offline:
 * swipe-right rate, completion rate and order conversion per model version and position.
 */
export function rulesRanker(store: DataStore, opts: { random?: () => number; onError?: (e: unknown) => void } = {}): Ranker {
  return {
    async rank({ userId, personalised, candidates, limit, now }) {
      const { config } = mergeRankingConfig(null);
      const ctx = await store.loadRankingContext(userId, {
        personalised,
        since: new Date(now.getTime() - config.lookbackDays * 86_400_000),
      });
      const merged = mergeRankingConfig(ctx.weights).config;
      const profile = personalised
        ? buildTasteProfile({ signals: ctx.signals, impressions: ctx.impressions, now, resetAt: ctx.resetAt, timezone: LAUNCH_CITY.timezone }, merged)
        : emptyProfile();
      const positives = personalised
        ? ctx.signals.filter((s) => ['right_swipe', 'like', 'order', 'save'].includes(s.kind) && s.videoId).map((s) => s.videoId!)
        : [];
      const ranked = rankFeed({
        candidates, profile, preferences: ctx.preferences, personalised, now, limit,
        collaborative: personalised ? collaborativeScores(positives, ctx.similarities ?? []) : undefined,
        timezone: LAUNCH_CITY.timezone, random: opts.random,
      }, merged);

      const feedRequestId = crypto.randomUUID();
      if (personalised && ranked.length) {
        // Fire-and-forget: logging must never slow down or break the feed.
        store.recordImpressions(userId, feedRequestId, merged.modelVersion, ranked.map((r, position) => ({
          videoId: r.candidate.videoId, position, score: Math.round(r.score * 1000) / 1000, exploration: r.exploration, reasons: r.reasons,
        }))).catch((e) => opts.onError?.(e));
      }
      return {
        feedRequestId,
        modelVersion: merged.modelVersion,
        items: ranked.map((r) => ({
          candidate: r.candidate,
          ranking: { score: Math.round(r.score * 1000) / 1000, reasons: r.reasons, exploration: r.exploration },
        })),
      };
    },
  };
}
