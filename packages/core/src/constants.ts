export const DIETARY_TAGS = ['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'halal', 'nut_free'] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

export const DIETARY_LABELS: Record<DietaryTag, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  gluten_free: 'Gluten free',
  dairy_free: 'Dairy free',
  halal: 'Halal',
  nut_free: 'Nut free',
};

/** Launch market. Other cities are rows in `public.cities`; nothing here is Brisbane-only logic. */
export const LAUNCH_CITY = {
  name: 'Brisbane',
  region: 'QLD',
  countryCode: 'AU',
  timezone: 'Australia/Brisbane',
  currency: 'AUD',
  locale: 'en-AU',
  centre: { lat: -27.4698, lng: 153.0251 },
} as const;

export const CONSENT_TYPES = ['personalisation', 'precise_location', 'marketing_email', 'marketing_push', 'analytics'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Cuisine keys used by menus and preferences (extend as restaurants onboard). */
export const CUISINES = [
  'american', 'chinese', 'desserts', 'greek', 'indian', 'italian', 'japanese', 'korean', 'lebanese', 'mexican', 'thai', 'vietnamese',
] as const;
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
