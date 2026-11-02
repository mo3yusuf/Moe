import { haversineKm } from './geo';

export interface DeliveryAddress {
  line1: string; line2?: string | null; suburb: string; region: string; postcode: string;
  lat: number; lng: number; contactPhone: string; instructions?: string | null;
}

export type DeliveryEligibility =
  | { ok: true; distanceKm: number }
  | { ok: false; reason: 'delivery_disabled' | 'out_of_range' | 'below_minimum'; message: string };

/** Restaurant-side delivery rules, checked before asking a delivery partner for a quote. */
export function checkDeliveryEligibility(
  location: { deliveryEnabled: boolean; deliveryRadiusKm: number | null; lat: number; lng: number; deliveryMinOrderCents: number },
  address: { lat: number; lng: number },
  subtotalCents: number,
): DeliveryEligibility {
  if (!location.deliveryEnabled || !location.deliveryRadiusKm) return { ok: false, reason: 'delivery_disabled', message: 'This restaurant offers pickup only' };
  const distanceKm = haversineKm(location.lat, location.lng, address.lat, address.lng);
  if (distanceKm > location.deliveryRadiusKm) return { ok: false, reason: 'out_of_range', message: `Delivery is available within ${location.deliveryRadiusKm} km` };
  if (subtotalCents < location.deliveryMinOrderCents) {
    return { ok: false, reason: 'below_minimum', message: `Delivery needs a minimum order of $${(location.deliveryMinOrderCents / 100).toFixed(2)}` };
  }
  return { ok: true, distanceKm };
}
