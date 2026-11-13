import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticKind = 'light' | 'medium' | 'success' | 'selection';

/**
 * Haptic feedback on every platform.
 * - iOS / Android apps: expo-haptics (Taptic Engine / vibration motor).
 * - Android browsers: the Vibration API.
 * - iPhone browsers: Safari has no vibration API, but since iOS 18 toggling an
 *   <input type="checkbox" switch> plays the system "tick" haptic. We keep one hidden switch and
 *   toggle it. This only works during a user interaction (a tap), which is when we call it.
 */
let iosSwitch: HTMLLabelElement | null = null;

function webTick(kind: HapticKind) {
  if (typeof window === 'undefined') return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate === 'function') {
    const pattern = kind === 'success' ? [18, 60, 28] : kind === 'medium' ? 22 : 12;
    try { nav.vibrate(pattern); } catch { /* blocked */ }
    return;
  }
  // iPhone Safari (no Vibration API): the hidden-switch trick.
  try {
    if (!iosSwitch) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      iosSwitch = label;
    }
    iosSwitch.click();
    if (kind === 'success') setTimeout(() => iosSwitch?.click(), 90); // a double tick for bigger moments
  } catch { /* unsupported */ }
}

export function haptic(kind: HapticKind = 'light') {
  if (Platform.OS === 'web') return webTick(kind);
  if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else if (kind === 'selection') void Haptics.selectionAsync();
  else void Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
}
