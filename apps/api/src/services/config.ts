import { DEFAULT_RECOMMENDATION_CONFIG, parseRecommendationConfig, type RecommendationConfig } from '@crave/core';
import type { Sql } from '../db';

let cache: { config: RecommendationConfig; at: number } | null = null;
const TTL_MS = 60_000;

/** Active admin-configured weights, falling back to the reviewed defaults in @crave/core. */
export async function activeRecommendationConfig(sql: Sql): Promise<RecommendationConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.config;
  const [row] = await sql<{ config: unknown }[]>`select config from public.recommendation_configs where is_active limit 1`;
  let config = DEFAULT_RECOMMENDATION_CONFIG;
  if (row) {
    try {
      config = parseRecommendationConfig(row.config);
    } catch (err) {
      console.error('Active recommendation config is invalid; using defaults', err);
    }
  }
  cache = { config, at: Date.now() };
  return config;
}

export function clearConfigCache(): void {
  cache = null;
}
