import type { FeedItem } from '@crave/core';

/**
 * DEMO MODE ONLY — fictional restaurants mirroring supabase/seed.sql. Videos are openly licensed
 * sample clips (Blender Foundation, CC BY) used to exercise the player; they are not food footage.
 */
const CLIPS = ['ForBiggerBlazes', 'ForBiggerEscapes', 'ForBiggerFun', 'ForBiggerJoyrides', 'ForBiggerMeltdowns'];
const clip = (i: number) => `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/${CLIPS[i % CLIPS.length]}.mp4`;

type Row = [string, string, string, string, number, string[], string, number, boolean, string | null, boolean];
// caption, restaurant, suburb, dish, priceCents, dietary, creator, distanceKm, halal, notOrderableReason, sponsored
const rows: Row[] = [
  ['The crunchiest smash burger in the Valley? 🍔', 'Valley Smash Burgers', 'Fortitude Valley', 'Classic Double Smash', 1690, ['halal'], 'brisbanebites', 1.8, true, null, false],
  ['Aburi salmon that melts. Friday sushi sorted.', 'Kurilpa Sushi Bar', 'South Brisbane', 'Aburi Salmon Nigiri (6pc)', 2200, ['dairy_free'], 'brisbanebites', 1.2, false, null, true],
  ['Birria dip test 🌮', 'West End Taqueria', 'West End', 'Birria Tacos with Consommé (3)', 2100, [], 'spicehunter', 2.0, false, null, false],
  ['Soup dumpling technique 101.', 'Sunnybank Dumpling House', 'Sunnybank', 'Xiao Long Bao (8)', 1380, [], 'brisbanebites', 12.4, false, null, false],
  ['Green curry prawns, properly hot.', 'New Farm Thai Kitchen', 'New Farm', 'Green Curry Prawns', 2490, ['gluten_free', 'dairy_free'], 'spicehunter', 2.2, false, 'restaurant_closed', false],
  ['Charcoal chicken + toum = perfect.', 'Gabba Charcoal Chicken', 'Woolloongabba', 'Half Charcoal Chicken & Chips', 1990, ['halal', 'gluten_free'], 'brisbanebites', 2.1, true, null, false],
  ['Cacio e pepe tossed tableside.', 'Paddington Pasta Co', 'Paddington', 'Cacio e Pepe', 2400, ['vegetarian'], 'brisbanebites', 2.1, false, 'item_unavailable', false],
  ['Pistachio bombolini pull-apart.', 'Bulimba Sweet Lab', 'Bulimba', 'Pistachio Bombolini (3)', 1200, ['vegetarian'], 'brisbanebites', 4.1, false, null, false],
];

export const DEMO_FEED: FeedItem[] = rows.map(([caption, restaurant, suburb, dish, price, dietary, creator, km, halal, reason, sponsored], i) => ({
  videoId: `demo-video-${i + 1}`,
  playbackUrl: clip(i),
  thumbnailUrl: null,
  durationMs: 15000,
  caption: `${caption} [DEMO]`,
  isSponsored: sponsored,
  sponsorDisclosure: sponsored ? `Paid partnership with ${restaurant} (demo)` : null,
  creator: { id: `demo-creator-${creator}`, handle: creator, displayName: creator },
  restaurant: { id: `demo-restaurant-${i}`, name: restaurant, slug: null, cuisines: [], priceLevel: 2, suburb, distanceKm: km, isOpen: reason !== 'restaurant_closed', halalCertified: halal, locationId: null },
  menuItem: { id: `demo-item-${i}`, name: dish, priceCents: price, currency: 'AUD', dietaryTags: dietary, spiceLevel: 0 },
  // Ordering is always disabled in demo mode, but the reasons are shown to preview the UI states.
  orderable: false,
  notOrderableReason: (reason as FeedItem['notOrderableReason']) ?? null,
  stats: { likes: 40 + i * 13, comments: 0 },
  viewer: { liked: false, saved: false, craved: false },
  ranking: null,
}));
