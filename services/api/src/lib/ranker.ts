import type { FeedCandidate, FeedItem } from '@crave/core';

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
