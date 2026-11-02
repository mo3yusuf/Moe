import { EMPTY_PREFERENCES, emptyTasteProfile, type ExplicitPreferences, type TasteProfile } from '@crave/core';
import type { Sql, Tx } from '../db';

/** Merge stored JSON with an empty profile so older/reset rows are always well-formed. */
export function normaliseProfile(raw: unknown): TasteProfile {
  const base = emptyTasteProfile();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<TasteProfile>;
  return {
    ...base,
    ...p,
    affinities: { ...base.affinities, ...(p.affinities ?? {}) },
    fulfilmentCounts: { ...base.fulfilmentCounts, ...(p.fulfilmentCounts ?? {}) },
    hiddenVideoIds: Array.isArray(p.hiddenVideoIds) ? p.hiddenVideoIds : [],
    orderedItemIds: Array.isArray(p.orderedItemIds) ? p.orderedItemIds : [],
  };
}

export async function loadTasteProfile(sql: Sql | Tx, userId: string): Promise<TasteProfile> {
  const [row] = await sql<{ profile: unknown }[]>`select profile from public.user_taste_profiles where user_id = ${userId}`;
  return normaliseProfile(row?.profile);
}

/** Locks (creating if needed) the user's profile row for a read-modify-write. */
export async function lockTasteProfile(tx: Tx, userId: string, configVersion: string): Promise<{ profile: TasteProfile; learningSince: Date }> {
  await tx`
    insert into public.user_taste_profiles (user_id, profile, config_version)
    values (${userId}, ${tx.json(emptyTasteProfile() as never)}, ${configVersion})
    on conflict (user_id) do nothing`;
  const [row] = await tx<{ profile: unknown; learning_since: Date }[]>`
    select profile, learning_since from public.user_taste_profiles where user_id = ${userId} for update`;
  return { profile: normaliseProfile(row?.profile), learningSince: row!.learning_since };
}

export async function saveTasteProfile(tx: Tx, userId: string, profile: TasteProfile, configVersion: string): Promise<void> {
  await tx`
    update public.user_taste_profiles
    set profile = ${tx.json(profile as never)}, config_version = ${configVersion}, signal_count = ${profile.signalCount}, updated_at = now()
    where user_id = ${userId}`;
}

export async function loadPreferences(sql: Sql | Tx, userId: string): Promise<ExplicitPreferences> {
  const [row] = await sql<
    {
      favourite_cuisines: string[];
      dietary_requirements: string[];
      dietary_preferences: string[];
      avoid_tags: string[];
      max_spice_level: number | null;
      budget_per_meal_cents: number | null;
    }[]
  >`select favourite_cuisines, dietary_requirements, dietary_preferences, avoid_tags, max_spice_level, budget_per_meal_cents
    from public.user_preferences where user_id = ${userId}`;
  if (!row) return EMPTY_PREFERENCES;
  return {
    favouriteCuisines: row.favourite_cuisines,
    dietaryRequirements: row.dietary_requirements,
    dietaryPreferences: row.dietary_preferences,
    avoidTags: row.avoid_tags,
    maxSpiceLevel: row.max_spice_level,
    budgetPerMealCents: row.budget_per_meal_cents,
  };
}

export async function personalisationEnabled(sql: Sql | Tx, userId: string): Promise<boolean> {
  const [row] = await sql<{ personalisation_enabled: boolean }[]>`select personalisation_enabled from public.profiles where id = ${userId}`;
  return row?.personalisation_enabled ?? false;
}

/** Customer-facing summary for "Why am I seeing this?" / privacy transparency. */
export function summariseProfile(profile: TasteProfile, now = new Date()) {
  const top = (dim: keyof TasteProfile['affinities'], sign: 1 | -1) =>
    Object.entries(profile.affinities[dim])
      .filter(([, e]) => e.score * sign > 0.5)
      .sort((a, b) => (b[1].score - a[1].score) * sign)
      .slice(0, 5)
      .map(([key, e]) => ({ key, score: Math.round(e.score * 10) / 10 }));
  void now;
  return {
    signalCount: profile.signalCount,
    likedCuisines: top('cuisine', 1),
    lessInterestedCuisines: top('cuisine', -1),
    likedTags: top('tag', 1),
    hiddenVideoCount: profile.hiddenVideoIds.length,
    typicalItemPriceCents: profile.avgOrderItemCents,
    pickupOrders: profile.fulfilmentCounts.pickup,
  };
}
