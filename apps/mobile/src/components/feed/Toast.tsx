import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { colors, radius } from '@/theme';

export interface ToastMessage {
  id: number;
  text: string;
  icon: 'flame' | 'eye-off' | 'information-circle';
}

/** Brief confirmation (e.g. "Saved to Cravings"), also announced to screen readers. */
export function Toast({ message }: { message: ToastMessage | null }) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (!message) return;
    AccessibilityInfo.announceForAccessibility(message.text);
    v.value = 0;
    v.value = withSequence(withSpring(1, { damping: 14 }), withDelay(1100, withTiming(0, { duration: 220 })));
  }, [message, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.85 + v.value * 0.15 }] }));
  if (!message) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, style]}>
      <Ionicons name={message.icon} size={22} color={message.icon === 'flame' ? colors.accent : colors.text} />
      <Text style={styles.text}>{message.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', alignSelf: 'center', top: '42%', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(15,15,15,0.92)', paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  text: { color: colors.text, fontWeight: '700', fontSize: 15 },
});
