import {
  ALLERGENS, buildTasteProfile, DIETARY_TAGS, emptyProfile, LAUNCH_CITY, mergeRankingConfig,
} from '@crave/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { badRequest } from '../lib/errors';

const Cuisine = z.string().trim().toLowerCase().regex(/^[a-z_]{2,30}$/);
const Preferences = z.object({
  favouriteCuisines: z.array(Cuisine).max(20).default([]),
  dislikedCuisines: z.array(Cuisine).max(20).default([]),
  dietaryRequirements: z.array(z.enum(DIETARY_TAGS)).max(6).default([]),
  avoidAllergens: z.array(z.enum(ALLERGENS)).max(13).default([]),
  spicePreference: z.number().int().min(0).max(4).nullable().default(null),
  typicalBudgetCents: z.number().int().min(0).max(100_000).nullable().default(null),
  preferredFulfilment: z.enum(['pickup', 'delivery']).nullable().default(null),
}).refine((p) => !p.favouriteCuisines.some((c) => p.dislikedCuisines.includes(c)), 'A cuisine cannot be both favourite and disliked');

export const tasteRoutes = new Hono<AppEnv>();

tasteRoutes.get('/preferences', async (c) => c.json(await c.get('deps').store.getPreferences(c.get('user').id)));

tasteRoutes.put('/preferences', async (c) => {
  const parsed = Preferences.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid preferences');
  await c.get('deps').store.setPreferences(c.get('user').id, parsed.data);
  return c.json(parsed.data);
});

const label = (f: string) => {
  const [type, ...rest] = f.split(':');
  const value = rest.join(':').replace(/_/g, ' ');
  return { type, value };
};

/**
 * "What CRAVE has learned about me" — the live taste profile, computed the same way the feed uses it.
 * Restaurant/creator ids are returned as ids; the app resolves names it already has.
 */
tasteRoutes.get('/taste-profile', async (c) => {
  const { store } = c.get('deps');
  const userId = c.get('user').id;
  const now = c.get('deps').now?.() ?? new Date();
  const personalised = await store.hasConsent(userId, 'personalisation');
  const { config } = mergeRankingConfig(null);
  const ctx = await store.loadRankingContext(userId, { personalised, since: new Date(now.getTime() - config.lookbackDays * 86_400_000) });
  const profile = personalised
    ? buildTasteProfile({ signals: ctx.signals, impressions: ctx.impressions, now, resetAt: ctx.resetAt, timezone: LAUNCH_CITY.timezone }, mergeRankingConfig(ctx.weights).config)
    : emptyProfile();
  const entries = [...profile.affinities.entries()].filter(([f]) => !f.startsWith('restaurant:') && !f.startsWith('creator:'));
  const likes = entries.filter(([, v]) => v > 0.1).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([f, v]) => ({ ...label(f), strength: Math.round(v * 100) / 100 }));
  const dislikes = entries.filter(([, v]) => v < -0.1).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([f, v]) => ({ ...label(f), strength: Math.round(v * 100) / 100 }));
  return c.json({
    personalised,
    resetAt: ctx.resetAt?.toISOString() ?? null,
    signalsUsed: profile.signalCount,
    typicalSpendCents: profile.typicalSpendCents,
    likes,
    dislikes,
    preferences: ctx.preferences,
  });
});
