import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export interface CoarseLocation {
  lat: number;
  lng: number;
  source: 'device' | 'default';
}

/** Brisbane CBD — used when location permission is not granted. */
export const DEFAULT_LOCATION: CoarseLocation = { lat: -27.47, lng: 153.03, source: 'default' };

/**
 * Approximate location only (~1 km). Precise coordinates never leave the
 * device for feed browsing, and nothing is stored server-side.
 */
export function useCoarseLocation(enabled = true): { location: CoarseLocation; status: 'idle' | 'loading' | 'granted' | 'denied' } {
  const [location, setLocation] = useState<CoarseLocation>(DEFAULT_LOCATION);
  const [status, setStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          if (!cancelled) setStatus('denied');
          return;
        }
        const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
        if (!cancelled && pos) {
          setLocation({ lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100, source: 'device' });
          setStatus('granted');
        }
      } catch {
        if (!cancelled) setStatus('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { location, status };
}
