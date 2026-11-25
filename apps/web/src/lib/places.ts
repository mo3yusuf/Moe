import 'server-only';
import { parsePlaceAddress, type PlaceAddress } from './places-parse';

/**
 * Address search for restaurant sign-up (Google Places API, server side so the key never reaches the
 * browser). Off unless GOOGLE_MAPS_API_KEY is set — the sign-up form then works as a plain form.
 * Suggestions are limited to Australia and biased towards Brisbane; only basic address fields are
 * requested (the cheapest Places tier). A session token groups typing + the final pick for billing.
 */
const KEY = () => process.env.GOOGLE_MAPS_API_KEY?.trim() || '';
export const placesEnabled = () => KEY().length > 0;

const BRISBANE = { latitude: -27.4698, longitude: 153.0251 };

export interface PlaceSuggestion { id: string; main: string; secondary: string }
export type { PlaceAddress } from './places-parse';

export async function suggestPlaces(input: string, sessionToken: string, fetchImpl: typeof fetch = fetch): Promise<PlaceSuggestion[]> {
  const res = await fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY() },
    body: JSON.stringify({
      input, sessionToken, includedRegionCodes: ['au'], languageCode: 'en-AU',
      locationBias: { circle: { center: BRISBANE, radius: 50_000 } },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Places autocomplete ${res.status}`);
  const body = (await res.json()) as { suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }; text?: { text?: string } } }[] };
  return (body.suggestions ?? []).flatMap((s) => {
    const p = s.placePrediction;
    if (!p?.placeId) return [];
    return [{ id: p.placeId, main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '', secondary: p.structuredFormat?.secondaryText?.text ?? '' }];
  }).slice(0, 6);
}

export async function placeAddress(placeId: string, sessionToken: string, fetchImpl: typeof fetch = fetch): Promise<PlaceAddress | null> {
  if (!/^[\w-]{10,300}$/.test(placeId)) return null;
  const res = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}&languageCode=en-AU`, {
    headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'addressComponents,formattedAddress,location' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Places details ${res.status}`);
  const p = (await res.json()) as Parameters<typeof parsePlaceAddress>[0];
  return parsePlaceAddress(p);
}
