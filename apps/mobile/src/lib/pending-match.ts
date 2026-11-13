import { Platform } from 'react-native';

/**
 * Invite links look like /match/K7Q2PX. Someone who opens one while signed out is sent to sign in
 * first, which would lose the code; remember it here and open the group straight after sign-in.
 */
const KEY = 'crave.pendingMatch';
const CODE = /^\/match\/([A-Za-z0-9]{6})\/?$/;

export function capturePendingMatch() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const m = window.location.pathname.match(CODE);
  if (m) try { window.localStorage.setItem(KEY, m[1]!.toUpperCase()); } catch { /* storage unavailable */ }
}

export function takePendingMatch(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const code = window.localStorage.getItem(KEY);
    if (code) window.localStorage.removeItem(KEY);
    return code;
  } catch { return null; }
}
