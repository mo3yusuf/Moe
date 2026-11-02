import type { FeedCandidate } from '../feed-types';
import type { RankingConfig } from './config';
import { buildTasteProfile, EMPTY_PREFERENCES, type Signal } from './profile';
import { collaborativeScores, rankFeed, seededRandom } from './rank';

/**
 * Offline hold-out evaluation. For each user, hide their most recent positive action, build their
 * profile from everything before it, rank the catalogue and check where the hidden video lands.
 * Compare configurations (weights, collaborative on/off) BEFORE rolling them out, then confirm online
 * with recommendation_performance() A/B by model version.
 */
export interface EvalUser { signals: Signal[] }
export interface EvalConfig { name: string; config: RankingConfig; useCollaborative: boolean }
export interface EvalResult { name: string; users: number; hitRateAtK: number; mrr: number; k: number }

const POSITIVE = new Set<Signal['kind']>(['right_swipe', 'like', 'order', 'save']);

export function holdoutEvaluate(
  users: EvalUser[],
  candidates: FeedCandidate[],
  configs: EvalConfig[],
  opts: { k?: number; similarities?: { videoId: string; similarVideoId: string; score: number }[]; now: Date },
): EvalResult[] {
  const k = opts.k ?? 10;
  const available = new Set(candidates.map((c) => c.videoId));
  return configs.map(({ name, config, useCollaborative }) => {
    let n = 0, hits = 0, rr = 0;
    for (const u of users) {
      const ordered = [...u.signals].sort((a, b) => a.at.getTime() - b.at.getTime());
      const lastIdx = ordered.map((s) => POSITIVE.has(s.kind) && !!s.videoId && available.has(s.videoId)).lastIndexOf(true);
      if (lastIdx < 1) continue; // need history before the held-out action
      const target = ordered[lastIdx]!.videoId!;
      const history = ordered.slice(0, lastIdx);
      const seen = new Set(history.map((s) => s.videoId).filter(Boolean) as string[]);
      const profile = buildTasteProfile({ signals: history, now: ordered[lastIdx]!.at }, config);
      const positives = history.filter((s) => POSITIVE.has(s.kind) && s.videoId).map((s) => s.videoId!);
      const ranked = rankFeed({
        candidates: candidates.filter((c) => !seen.has(c.videoId)),
        profile, preferences: EMPTY_PREFERENCES, personalised: true, now: opts.now, limit: candidates.length,
        collaborative: useCollaborative ? collaborativeScores(positives, opts.similarities ?? []) : undefined,
        random: seededRandom(n + 1),
      }, config);
      const pos = ranked.findIndex((r) => r.candidate.videoId === target);
      n += 1;
      if (pos >= 0 && pos < k) hits += 1;
      if (pos >= 0) rr += 1 / (pos + 1);
    }
    return { name, users: n, k, hitRateAtK: n ? hits / n : 0, mrr: n ? rr / n : 0 };
  });
}
