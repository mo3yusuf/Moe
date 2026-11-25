import 'server-only';
import { parsePhotonFeature, parsePlaceAddress, typedHouseNumber, type PhotonFeature, type PlaceAddress } from './places-parse';

/**
 * Address search for restaurant sign-up, server side.
 *  - Default: Photon (free OpenStreetMap search; no account or key), limited to South East Queensland.
 *  - If GOOGLE_MAPS_API_KEY is set: Google Places API (New) instead (more accurate, finds businesses by
 *    name). Only basic address fields are requested; a session token groups typing + the pick for billing.
 * ADDRESS_SEARCH=off turns it off entirely (the form then works as a plain form).
 */
const KEY = () => process.env.GOOGLE_MAPS_API_KEY?.trim() || '';
export const placesEnabled = () => process.env.ADDRESS_SEARCH !== 'off';
const useGoogle = () => KEY().length > 0;

const BRISBANE = { latitude: -27.4698, longitude: 153.0251 };

/** `address` is filled in straight away when the provider returns it with the suggestion (Photon). */
export interface PlaceSuggestion { id: string; main: string; secondary: string; address?: PlaceAddress }
export type { PlaceAddress } from './places-parse';

export async function suggestPlaces(input: string, sessionToken: string, fetchImpl: typeof fetch = fetch): Promise<PlaceSuggestion[]> {
  if (!useGoogle()) return suggestPhoton(input, fetchImpl);
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

/** Photon (photon.komoot.io): free, fair-use public instance — fine for occasional restaurant sign-ups. */
async function suggestPhoton(input: string, fetchImpl: typeof fetch): Promise<PlaceSuggestion[]> {
  const url = new URL('https://photon.komoot.io/api/');
  const params = new URLSearchParams({
    q: input, limit: '10', lang: 'en', lat: String(BRISBANE.latitude), lon: String(BRISBANE.longitude),
    bbox: '151.9,-28.4,153.6,-26.5', // South East Queensland
  });
  for (const tag of ['!highway:bus_stop', '!public_transport', '!railway']) params.append('osm_tag', tag); // no bus stops / stations
  url.search = params.toString();
  const typedNumber = typedHouseNumber(input);
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'CRAVE restaurant sign-up' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const body = (await res.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  return (body.features ?? []).flatMap((f) => {
    const s = parsePhotonFeature(f, typedNumber);
    if (!s || seen.has(`${s.main}|${s.secondary}`)) return [];
    seen.add(`${s.main}|${s.secondary}`);
    return [s];
  }).slice(0, 6);
}
