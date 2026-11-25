/** `approximate`: the map only knew the street, so the location is on the street, not the exact door. */
export interface PlaceAddress { line1: string; suburb: string; postcode: string; state: string; lat: number; lng: number; formatted: string; approximate?: boolean }
type Component = { longText?: string; shortText?: string; types?: string[] };

/** Pulls street / suburb / postcode / state out of Google Places address components. */
export function parsePlaceAddress(p: { addressComponents?: Component[]; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }): PlaceAddress | null {
  const get = (type: string, short = false) => {
    const c = (p.addressComponents ?? []).find((x) => x.types?.includes(type));
    return (short ? c?.shortText : c?.longText) ?? '';
  };
  const lat = p.location?.latitude, lng = p.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const unit = get('subpremise');
  const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
  return {
    line1: `${unit ? `${unit}/` : ''}${street}`.trim() || (p.formattedAddress?.split(',')[0] ?? ''),
    suburb: get('locality') || get('sublocality') || get('postal_town'),
    postcode: get('postal_code'),
    state: get('administrative_area_level_1', true),
    lat, lng,
    formatted: p.formattedAddress ?? '',
  };
}

/** One feature from Photon (free OpenStreetMap address search). */
export interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string; osm_id?: number; name?: string; housenumber?: string; street?: string; postcode?: string;
    district?: string; locality?: string; city?: string; state?: string; countrycode?: string; type?: string;
    osm_key?: string; osm_value?: string;
  };
}

const STATE_CODES: Record<string, string> = {
  Queensland: 'QLD', 'New South Wales': 'NSW', Victoria: 'VIC', 'South Australia': 'SA', 'Western Australia': 'WA',
  Tasmania: 'TAS', 'Northern Territory': 'NT', 'Australian Capital Territory': 'ACT',
};

/** The house number at the start of what was typed, e.g. "82", "82A", "3/100" or "12-14". */
export function typedHouseNumber(query: string): string | null {
  return query.trim().match(/^(\d{1,5}[a-zA-Z]?(?:[/-]\d{1,5}[a-zA-Z]?)?)\s+\D/)?.[1] ?? null;
}

const NOT_ADDRESSES = new Set(['public_transport', 'railway', 'aeroway']);

/**
 * A Photon feature as a suggestion with its full address (no second lookup needed). OpenStreetMap
 * doesn't know every house number (especially in newer suburbs): when a whole street comes back, the
 * number the person typed is kept, and the address is marked approximate (located on the street).
 */
export function parsePhotonFeature(f: PhotonFeature, typedNumber: string | null = null): { id: string; main: string; secondary: string; address: PlaceAddress } | null {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== 'number' || typeof lng !== 'number' || (p.countrycode && p.countrycode.toUpperCase() !== 'AU')) return null;
  if (NOT_ADDRESSES.has(p.osm_key ?? '') || (p.osm_key === 'highway' && p.osm_value !== undefined && ['bus_stop', 'platform', 'stop'].includes(p.osm_value))) return null;
  const isStreet = p.type === 'street' || (p.osm_key === 'highway' && !p.housenumber);
  const number = p.housenumber ?? (isStreet && typedNumber ? typedNumber : undefined);
  const approximate = !p.housenumber && !!number;
  const street = [number, p.street ?? (isStreet ? p.name : undefined)].filter(Boolean).join(' ');
  const suburb = p.district || p.locality || p.city || '';
  const state = p.state ? STATE_CODES[p.state] ?? p.state : '';
  const line1 = street || p.name || '';
  if (!line1) return null;
  // A business or place: show its name first, then its street.
  const isPlace = !!p.name && p.name !== p.street && !isStreet;
  const where = [suburb, [state, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return {
    id: `${p.osm_type ?? 'x'}${p.osm_id ?? `${lat},${lng}`}${approximate ? `#${number}` : ''}`,
    main: isPlace ? p.name! : line1,
    secondary: isPlace ? [street, where].filter(Boolean).join(', ') : where,
    address: { line1, suburb, postcode: p.postcode ?? '', state, lat, lng, formatted: [line1, where].filter(Boolean).join(', '), ...(approximate ? { approximate } : {}) },
  };
}
