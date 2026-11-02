import { z } from 'zod';

// ---------------------------------------------------------------------------
// Australian addresses
// ---------------------------------------------------------------------------

export const AU_STATES = ['QLD', 'NSW', 'VIC', 'ACT', 'TAS', 'SA', 'WA', 'NT'] as const;
export type AuState = (typeof AU_STATES)[number];

/** Rough postcode ranges per state (Australia Post). Used as a sanity check only. */
const POSTCODE_RANGES: Record<AuState, [number, number][]> = {
  NSW: [[1000, 2599], [2619, 2899], [2921, 2999]],
  ACT: [[200, 299], [2600, 2618], [2900, 2920]],
  VIC: [[3000, 3999], [8000, 8999]],
  QLD: [[4000, 4999], [9000, 9999]],
  SA: [[5000, 5999]],
  WA: [[6000, 6999]],
  TAS: [[7000, 7999]],
  NT: [[800, 999]],
};

export function postcodeMatchesState(postcode: string, state: AuState): boolean {
  const n = Number(postcode);
  return POSTCODE_RANGES[state].some(([lo, hi]) => n >= lo && n <= hi);
}

export const AuAddressSchema = z
  .object({
    unit: z.string().trim().max(20).optional(),
    streetLine: z.string().trim().min(3).max(120),
    suburb: z.string().trim().min(2).max(60),
    state: z.enum(AU_STATES),
    postcode: z.string().regex(/^\d{4}$/, 'Postcode must be 4 digits'),
    country: z.literal('AU').default('AU'),
  })
  .refine((a) => postcodeMatchesState(a.postcode, a.state), {
    message: 'Postcode does not match state',
    path: ['postcode'],
  });

export type AuAddress = z.infer<typeof AuAddressSchema>;

/** Australia Post style single-line format: "Unit 2/15 Example St, Fortitude Valley QLD 4006". */
export function formatAuAddress(a: Pick<AuAddress, 'unit' | 'streetLine' | 'suburb' | 'state' | 'postcode'>): string {
  const street = a.unit ? `${a.unit}/${a.streetLine}` : a.streetLine;
  return `${street}, ${a.suburb} ${a.state} ${a.postcode}`;
}

/** Australian Business Number checksum (ATO algorithm). */
export function isValidAbn(raw: string): boolean {
  const digits = raw.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = digits.split('').map(Number);
  nums[0] = (nums[0] ?? 0) - 1;
  const sum = nums.reduce((acc, d, i) => acc + d * (weights[i] ?? 0), 0);
  return sum % 89 === 0;
}

// ---------------------------------------------------------------------------
// Video uploads
// ---------------------------------------------------------------------------

export const VIDEO_LIMITS = {
  maxBytes: 200 * 1024 * 1024, // 200 MB
  minDurationMs: 3_000,
  maxDurationMs: 180_000, // 3 minutes
  allowedMimeTypes: ['video/mp4', 'video/quicktime'] as const,
  maxCaptionLength: 300,
  maxHashtags: 10,
} as const;

export const VideoUploadSchema = z.object({
  mimeType: z.enum(VIDEO_LIMITS.allowedMimeTypes),
  sizeBytes: z.number().int().positive().max(VIDEO_LIMITS.maxBytes, 'Video is larger than 200 MB'),
  durationMs: z
    .number()
    .int()
    .min(VIDEO_LIMITS.minDurationMs, 'Video must be at least 3 seconds')
    .max(VIDEO_LIMITS.maxDurationMs, 'Video must be 3 minutes or shorter'),
  caption: z.string().trim().max(VIDEO_LIMITS.maxCaptionLength).default(''),
  /** Creator confirms they own the video or have permission to upload it. */
  rightsConfirmed: z.literal(true, { errorMap: () => ({ message: 'You must confirm you have the rights to this video' }) }),
  /** Paid partnership / gifted meal disclosure (ACCC influencer guidance). */
  isSponsored: z.boolean().default(false),
  sponsorDisclosure: z.string().trim().max(120).optional(),
  restaurantId: z.string().uuid().optional(),
  menuItemIds: z.array(z.string().uuid()).max(5).default([]),
}).refine((v) => !v.isSponsored || (v.sponsorDisclosure && v.sponsorDisclosure.length > 0), {
  message: 'Sponsored videos need a disclosure (e.g. "Paid partnership with …")',
  path: ['sponsorDisclosure'],
});

export type VideoUploadInput = z.infer<typeof VideoUploadSchema>;

export function extractHashtags(caption: string): string[] {
  const tags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(tags.map((t) => t.slice(1).toLowerCase()))].slice(0, VIDEO_LIMITS.maxHashtags);
}

// ---------------------------------------------------------------------------
// Interaction events (sent by the app, validated by the API)
// ---------------------------------------------------------------------------

export const INTERACTION_EVENT_TYPES = [
  'impression',
  'watch',
  'crave_swipe',
  'not_for_me_swipe',
  'like',
  'unlike',
  'save_meal',
  'unsave_meal',
  'share',
  'comment',
  'menu_item_click',
  'add_to_basket',
  'search',
  'follow_restaurant',
  'follow_creator',
] as const;
export type InteractionEventType = (typeof INTERACTION_EVENT_TYPES)[number];

export const InteractionEventSchema = z.object({
  /** Client-generated id makes event ingestion idempotent across retries. */
  clientEventId: z.string().uuid(),
  type: z.enum(INTERACTION_EVENT_TYPES),
  videoId: z.string().uuid().optional(),
  menuItemId: z.string().uuid().optional(),
  restaurantId: z.string().uuid().optional(),
  creatorId: z.string().uuid().optional(),
  occurredAt: z.string().datetime(),
  watchedMs: z.number().int().min(0).max(3_600_000).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  loops: z.number().int().min(0).max(100).optional(),
  /** Search text is truncated and never linked to location. */
  query: z.string().trim().max(80).optional(),
  feedSessionId: z.string().uuid().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
export type InteractionEvent = z.infer<typeof InteractionEventSchema>;

export const InteractionBatchSchema = z.object({
  events: z.array(InteractionEventSchema).min(1).max(100),
});
