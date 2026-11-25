export interface PlaceAddress { line1: string; suburb: string; postcode: string; state: string; lat: number; lng: number; formatted: string }
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
