import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Feed sound on/off, shared by every video. Browsers only autoplay videos that are muted, so on the
 * web the feed starts muted (like TikTok's website) and the viewer taps the speaker to turn sound on;
 * that tap counts as the user gesture browsers require. Native apps start with sound.
 */
let soundOn = Platform.OS !== 'web';
const listeners = new Set<() => void>();

export function setSoundOn(on: boolean) {
  soundOn = on;
  for (const l of listeners) l();
}

export function useSoundOn(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => soundOn,
    () => soundOn,
  );
}
