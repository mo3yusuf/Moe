import { LAUNCH_CITY } from '@crave/core';
import * as Location from 'expo-location';

export interface Coarse { lat: number; lng: number; source: 'device' | 'default' }

/**
 * Approximate location for serviceability. Never prompts here (prompts happen from an explicit
 * "Use my location" action). Coordinates are rounded to ~1 km before leaving the device.
 */
export async function getCoarseLocation(): Promise<Coarse> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) {
      const pos = (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }))
        ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (pos) return { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude), source: 'device' };
    }
  } catch {
    // fall through to default
  }
  return { ...LAUNCH_CITY.centre, source: 'default' };
}

const round = (n: number) => Math.round(n * 100) / 100;
