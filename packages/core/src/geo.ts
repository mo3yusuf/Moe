export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in kilometres (haversine). Mirrors public.distance_km in SQL. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Rounds a coordinate to ~1.1 km precision. The app sends coarse location for
 * feed ranking so precise location never leaves the device for browsing.
 */
export function coarsen(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
